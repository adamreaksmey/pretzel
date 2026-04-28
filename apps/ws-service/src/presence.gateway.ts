import { Logger } from '@nestjs/common';
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
import { PresenceService } from './presence.service';
import { resolveTenantIdFromApiKey } from './tenant-resolver';
import type {
  ConnectionAuthPayload,
  ConnectionContext,
  TenantPresenceEvent,
} from './ws.types';

const ROOM_PREFIX = 'tenant';
const PING_EVENT = 'ping';
const START_TYPING_EVENT = 'startTyping';
const STOP_TYPING_EVENT = 'stopTyping';
const SESSION_ASSIGNED_EVENT = 'session_assigned';
const ERROR_EVENT = 'error';
const LOGGER_CONTEXT = 'PresenceGateway';

@WebSocketGateway({ cors: { origin: '*' } })
export class PresenceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(LOGGER_CONTEXT);
  private readonly connectionBySocketId = new Map<string, ConnectionContext>();

  constructor(private readonly presenceService: PresenceService) {}

  async afterInit(): Promise<void> {
    this.presenceService.setEventPublisher((event) => {
      this.publishEvent(event);
    });
    await this.presenceService.startExpiryListener();
  }

  async handleConnection(client: Socket): Promise<void> {
    const authPayload = client.handshake.auth as ConnectionAuthPayload;
    const apiKey = this.readText(authPayload.apiKey);
    const userId = this.readText(authPayload.userId);
    const tenantId = resolveTenantIdFromApiKey(apiKey);
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
    this.connectionBySocketId.delete(client.id);
  }

  @SubscribeMessage(PING_EVENT)
  async handlePing(@ConnectedSocket() client: Socket): Promise<void> {
    const connection = this.connectionBySocketId.get(client.id);
    if (!connection) {
      return;
    }

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

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
