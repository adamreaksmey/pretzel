import { Injectable } from '@nestjs/common';
import {
  assertKeyspaceNotificationsEnabled,
  lastSeenKey,
  redisClient,
  sessionKey,
  typingKey,
  userSessionsKey,
} from '@pretzel/redis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  SESSION_EXPIRES_EVENT_CHANNEL,
  SESSION_HASH_EXPIRES_AT_FIELD,
  SESSION_HASH_TENANT_ID_FIELD,
  SESSION_HASH_USER_ID_FIELD,
  SESSION_TTL_SECONDS,
  TYPING_TTL_SECONDS,
} from './constants';
import type {
  ConnectionContext,
  SessionIdentity,
  TenantPresenceEvent,
} from './ws.types';

type PresenceEventType = TenantPresenceEvent['type'];
type EventPublisher = (event: TenantPresenceEvent) => void;

const SESSION_KEY_PREFIX = 'session:';
const TYPING_KEY_PREFIX = 'typing:';

@Injectable()
export class PresenceService {
  private readonly sessionIdentityBySessionId = new Map<
    string,
    SessionIdentity
  >();
  private readonly subscriptionClient: Redis;
  private emitEvent: EventPublisher = () => undefined;

  constructor() {
    this.subscriptionClient = redisClient.duplicate();
  }

  async startExpiryListener(): Promise<void> {
    await assertKeyspaceNotificationsEnabled(redisClient);
    await this.subscriptionClient.subscribe(SESSION_EXPIRES_EVENT_CHANNEL);
    this.subscriptionClient.on('message', (_channel, expiredKey) => {
      void this.processExpiredKey(expiredKey);
    });
  }

  setEventPublisher(eventPublisher: EventPublisher): void {
    this.emitEvent = eventPublisher;
  }

  async registerConnection(
    tenantId: string,
    userId: string,
  ): Promise<ConnectionContext> {
    const sessionId = randomUUID();
    const sessionStorageKey = sessionKey(sessionId);
    const userSessionSetKey = userSessionsKey(tenantId, userId);
    const expiresAtIso = this.createSessionExpiryTimestamp();
    const transactionReply = await redisClient
      .multi()
      .hset(sessionStorageKey, {
        [SESSION_HASH_USER_ID_FIELD]: userId,
        [SESSION_HASH_TENANT_ID_FIELD]: tenantId,
        [SESSION_HASH_EXPIRES_AT_FIELD]: expiresAtIso,
      })
      .expire(sessionStorageKey, SESSION_TTL_SECONDS)
      .sadd(userSessionSetKey, sessionId)
      .scard(userSessionSetKey)
      .exec();

    const activeSessionCount = this.readIntegerResult(transactionReply, 3);
    this.sessionIdentityBySessionId.set(sessionId, { tenantId, userId });
    this.publishTransitionEvent(
      activeSessionCount === 1,
      'user_online',
      tenantId,
      userId,
    );
    return { sessionId, tenantId, userId };
  }

  async refreshSessionHeartbeat(sessionId: string): Promise<boolean> {
    const sessionStorageKey = sessionKey(sessionId);
    const updatedExpiresAt = this.createSessionExpiryTimestamp();
    const transactionReply = await redisClient
      .multi()
      .hset(sessionStorageKey, SESSION_HASH_EXPIRES_AT_FIELD, updatedExpiresAt)
      .expire(sessionStorageKey, SESSION_TTL_SECONDS)
      .exec();

    const expireResult = this.readIntegerResult(transactionReply, 1);
    return expireResult === 1;
  }

  async cleanupSession(sessionId: string): Promise<void> {
    const identity = await this.resolveSessionIdentity(sessionId);
    if (!identity) {
      return;
    }

    const sessionStorageKey = sessionKey(sessionId);
    const userSessionSetKey = userSessionsKey(
      identity.tenantId,
      identity.userId,
    );
    const nowIso = new Date().toISOString();
    const transactionReply = await redisClient
      .multi()
      .del(sessionStorageKey)
      .srem(userSessionSetKey, sessionId)
      .scard(userSessionSetKey)
      .set(lastSeenKey(identity.tenantId, identity.userId), nowIso)
      .exec();

    const activeSessionCount = this.readIntegerResult(transactionReply, 2);
    this.sessionIdentityBySessionId.delete(sessionId);
    this.publishTransitionEvent(
      activeSessionCount === 0,
      'user_offline',
      identity.tenantId,
      identity.userId,
    );
  }

  async startTyping(tenantId: string, userId: string): Promise<void> {
    const typingStorageKey = typingKey(tenantId, userId);
    const typingTtlSeconds = String(TYPING_TTL_SECONDS);
    const initialTypingSetResult = await redisClient.set(
      typingStorageKey,
      '1',
      'EX',
      typingTtlSeconds,
      'NX',
    );
    if (initialTypingSetResult === 'OK') {
      this.publishEvent('typing_start', tenantId, userId);
      return;
    }

    await redisClient.expire(typingStorageKey, typingTtlSeconds);
  }

  async stopTyping(tenantId: string, userId: string): Promise<void> {
    const typingStorageKey = typingKey(tenantId, userId);
    const deletedTypingKeyCount = await redisClient.del(typingStorageKey);
    if (deletedTypingKeyCount === 0) {
      return;
    }

    this.publishEvent('typing_stop', tenantId, userId);
  }

  private async processExpiredKey(expiredKey: string): Promise<void> {
    if (expiredKey.startsWith(SESSION_KEY_PREFIX)) {
      const expiredSessionId = expiredKey.slice(SESSION_KEY_PREFIX.length);
      await this.cleanupSession(expiredSessionId);
      return;
    }

    if (!expiredKey.startsWith(TYPING_KEY_PREFIX)) {
      return;
    }

    const typingIdentity = this.extractTypingIdentity(expiredKey);
    if (!typingIdentity) {
      return;
    }

    this.publishEvent(
      'typing_stop',
      typingIdentity.tenantId,
      typingIdentity.userId,
    );
  }

  private createSessionExpiryTimestamp(): string {
    const sessionTtlMilliseconds = SESSION_TTL_SECONDS * 1000;
    return new Date(Date.now() + sessionTtlMilliseconds).toISOString();
  }

  private readIntegerResult(reply: unknown, index: number): number {
    if (!Array.isArray(reply)) {
      throw new Error('Redis transaction did not return a valid array.');
    }

    const replyEntries = reply as unknown[];
    const resultEntry: unknown = replyEntries[index];
    if (!this.isIntegerReplyEntry(resultEntry)) {
      throw new Error(
        'Redis transaction returned an invalid integer response.',
      );
    }

    return resultEntry[1];
  }

  private isIntegerReplyEntry(entry: unknown): entry is [unknown, number] {
    if (!Array.isArray(entry) || entry.length < 2) {
      return false;
    }

    return typeof entry[1] === 'number';
  }

  private async resolveSessionIdentity(
    sessionId: string,
  ): Promise<SessionIdentity | null> {
    const cachedIdentity = this.sessionIdentityBySessionId.get(sessionId);
    if (cachedIdentity) {
      return cachedIdentity;
    }

    const sessionFields = await redisClient.hgetall(sessionKey(sessionId));
    const tenantId = sessionFields[SESSION_HASH_TENANT_ID_FIELD];
    const userId = sessionFields[SESSION_HASH_USER_ID_FIELD];
    if (!tenantId || !userId) {
      return null;
    }

    const identity = { tenantId, userId };
    this.sessionIdentityBySessionId.set(sessionId, identity);
    return identity;
  }

  private extractTypingIdentity(expiredKey: string): SessionIdentity | null {
    const [, tenantId, userId] = expiredKey.split(':');
    if (!tenantId || !userId) {
      return null;
    }

    const typingStorageKey = typingKey(tenantId, userId);
    if (typingStorageKey !== expiredKey) {
      return null;
    }

    return { tenantId, userId };
  }

  private publishTransitionEvent(
    shouldPublish: boolean,
    eventType: PresenceEventType,
    tenantId: string,
    userId: string,
  ): void {
    if (!shouldPublish) {
      return;
    }

    this.publishEvent(eventType, tenantId, userId);
  }

  private publishEvent(
    eventType: PresenceEventType,
    tenantId: string,
    userId: string,
  ): void {
    this.emitEvent({
      type: eventType,
      tenantId,
      userId,
      targetUserId: userId,
      timestamp: new Date().toISOString(),
    });
  }
}
