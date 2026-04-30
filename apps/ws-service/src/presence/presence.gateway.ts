import { Logger } from '@nestjs/common';
import { redisClient } from '@pretzel/redis';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { ApiKeyValidationService } from '../auth/api-key-validation.service';
import { PresenceService } from './presence.service';
import type {
  ConnectionAuthPayload,
  ConnectionContext,
  TenantPresenceEvent,
} from './presence.types';

const ROOM_PREFIX = 'tenant';
const PING_EVENT = 'ping';
const START_TYPING_EVENT = 'startTyping';
const STOP_TYPING_EVENT = 'stopTyping';
const SESSION_ASSIGNED_EVENT = 'session_assigned';
const ERROR_EVENT = 'error';
const LOGGER_CONTEXT = 'PresenceGateway';
const REVOCATION_EVENT_CHANNEL = 'auth.revoked';
const HANDSHAKE_RATE_LIMIT_KEY_PREFIX = 'ratelimit:handshake';
const HANDSHAKE_WINDOW_SECONDS = 60;
const HANDSHAKE_MAX_ATTEMPTS = 10;
const TOO_MANY_REQUESTS_CODE = 429;
const REDIS_TIMEOUT_MS = 3000;
const MIN_HEARTBEAT_INTERVAL_MS = 5000;

@WebSocketGateway({ cors: { origin: '*' } })
export class PresenceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(LOGGER_CONTEXT);
  private readonly connectionBySocketId = new Map<string, ConnectionContext>();
  private readonly lastPingAtBySessionId = new Map<string, number>();
  private readonly revocationSubscriptionClient: Redis;

  constructor(
    private readonly apiKeyValidationService: ApiKeyValidationService,
    private readonly presenceService: PresenceService,
  ) {
    this.revocationSubscriptionClient = redisClient.duplicate();
  }

  async afterInit(): Promise<void> {
    this.presenceService.setEventPublisher((event) => {
      this.publishEvent(event);
    });
    await this.presenceService.startExpiryListener();
    await this.withRedisTimeout('subscribe auth.revoked channel', () =>
      this.revocationSubscriptionClient.subscribe(REVOCATION_EVENT_CHANNEL),
    );
    this.revocationSubscriptionClient.on('message', (channel, payload) => {
      if (channel !== REVOCATION_EVENT_CHANNEL) {
        return;
      }
      void this.handleRevocationMessage(payload);
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const connectionIp = this.readClientIp(client);
    const isRateLimited = await this.isHandshakeRateLimited(connectionIp);
    if (isRateLimited) {
      client.emit(ERROR_EVENT, {
        code: TOO_MANY_REQUESTS_CODE,
        message: 'Too many connection attempts. Please retry later.',
      });
      client.disconnect(true);
      return;
    }

    const authPayload = client.handshake.auth as ConnectionAuthPayload;
    const apiKey = this.readText(authPayload.apiKey);
    const userId = this.readText(authPayload.userId);
    const tenantId = await this.apiKeyValidationService.validateApiKey(apiKey);
    if (!tenantId || !userId) {
      client.emit(ERROR_EVENT, { message: 'Invalid connection auth payload.' });
      client.disconnect(true);
      return;
    }

    const connection = await this.presenceService.registerConnection(
      tenantId,
      userId,
    );
    this.connectionBySocketId.set(client.id, connection);
    await client.join(this.getTenantRoom(tenantId));
    client.emit(SESSION_ASSIGNED_EVENT, { sessionId: connection.sessionId });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const connection = this.connectionBySocketId.get(client.id);
    if (!connection) {
      return;
    }

    await this.presenceService.cleanupSession(connection.sessionId);
    this.lastPingAtBySessionId.delete(connection.sessionId);
    this.connectionBySocketId.delete(client.id);
  }

  @SubscribeMessage(PING_EVENT)
  async handlePing(@ConnectedSocket() client: Socket): Promise<void> {
    const connection = this.connectionBySocketId.get(client.id);
    if (!connection) {
      return;
    }

    const now = Date.now();
    const lastPingAt =
      this.lastPingAtBySessionId.get(connection.sessionId) ?? 0;
    if (now - lastPingAt < MIN_HEARTBEAT_INTERVAL_MS) {
      return;
    }
    this.lastPingAtBySessionId.set(connection.sessionId, now);

    const heartbeatUpdated = await this.presenceService.refreshSessionHeartbeat(
      connection.sessionId,
    );
    if (heartbeatUpdated) {
      return;
    }

    this.logger.warn(
      `Heartbeat refresh failed for session ${connection.sessionId}.`,
    );
    await this.presenceService.cleanupSession(connection.sessionId);
    this.lastPingAtBySessionId.delete(connection.sessionId);
    this.connectionBySocketId.delete(client.id);
    client.disconnect(true);
  }

  @SubscribeMessage(START_TYPING_EVENT)
  async handleStartTyping(@ConnectedSocket() client: Socket): Promise<void> {
    const connection = this.connectionBySocketId.get(client.id);
    if (!connection) {
      return;
    }

    await this.presenceService.startTyping(
      connection.tenantId,
      connection.userId,
    );
  }

  @SubscribeMessage(STOP_TYPING_EVENT)
  async handleStopTyping(@ConnectedSocket() client: Socket): Promise<void> {
    const connection = this.connectionBySocketId.get(client.id);
    if (!connection) {
      return;
    }

    await this.presenceService.stopTyping(
      connection.tenantId,
      connection.userId,
    );
  }

  private publishEvent(event: TenantPresenceEvent): void {
    const tenantRoom = this.getTenantRoom(String(event.tenantId));
    this.server.to(tenantRoom).emit(event.type, event);
  }

  private getTenantRoom(tenantId: string): string {
    return `${ROOM_PREFIX}:${tenantId}`;
  }

  private async handleRevocationMessage(payload: string): Promise<void> {
    const tenantId = this.readTenantIdFromRevocation(payload);
    if (!tenantId) {
      return;
    }

    const tenantRoom = this.getTenantRoom(tenantId);
    const sockets = await this.server.in(tenantRoom).fetchSockets();
    sockets.forEach((socket) => {
      socket.emit(ERROR_EVENT, {
        message: 'API key was revoked. Connection will close.',
      });
      socket.disconnect(true);
    });
  }

  private readTenantIdFromRevocation(payload: string): string | null {
    try {
      const parsedPayload = JSON.parse(payload) as {
        tenantId?: unknown;
      };
      return this.readText(parsedPayload.tenantId) || null;
    } catch {
      return null;
    }
  }

  private async isHandshakeRateLimited(clientIp: string): Promise<boolean> {
    const rateLimitKey = `${HANDSHAKE_RATE_LIMIT_KEY_PREFIX}:${clientIp}`;
    const attemptCount = await this.withRedisTimeout(
      'increment handshake rate limit',
      () => redisClient.incr(rateLimitKey),
    );
    if (attemptCount === 1) {
      await this.withRedisTimeout('set handshake rate limit ttl', () =>
        redisClient.expire(rateLimitKey, HANDSHAKE_WINDOW_SECONDS),
      );
    }
    return attemptCount > HANDSHAKE_MAX_ATTEMPTS;
  }

  private async withRedisTimeout<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Redis operation timed out: ${operationName}`));
      }, REDIS_TIMEOUT_MS);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } catch (error) {
      this.logger.error(
        `Redis operation failed: ${operationName}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new Error(`Redis operation failed: ${operationName}`);
    }
  }

  private readClientIp(client: Socket): string {
    const forwardedHeader = client.handshake.headers['x-forwarded-for'];
    if (typeof forwardedHeader === 'string' && forwardedHeader.trim()) {
      return forwardedHeader.split(',')[0]?.trim() ?? 'unknown';
    }

    return this.readText(client.handshake.address) || 'unknown';
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
