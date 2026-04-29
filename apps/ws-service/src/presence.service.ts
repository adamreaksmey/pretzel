import { Injectable, Logger } from '@nestjs/common';
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
const SESSION_COLLISION_RETRY_LIMIT = 1;
const REGISTER_SESSION_SCRIPT = `
  local sessionKey = KEYS[1]
  local userSessionSetKey = KEYS[2]
  local sessionId = ARGV[1]
  local userId = ARGV[2]
  local tenantId = ARGV[3]
  local expiresAtIso = ARGV[4]
  local sessionTtlSeconds = tonumber(ARGV[5])

  local reserved = redis.call('SET', sessionKey, '__reserved__', 'NX', 'EX', sessionTtlSeconds)
  if not reserved then
    return {0, 0}
  end

  redis.call('DEL', sessionKey)
  redis.call(
    'HSET',
    sessionKey,
    'user_id',
    userId,
    'tenant_id',
    tenantId,
    'expires_at',
    expiresAtIso
  )
  redis.call('EXPIRE', sessionKey, sessionTtlSeconds)
  redis.call('SADD', userSessionSetKey, sessionId)
  local activeSessionCount = redis.call('SCARD', userSessionSetKey)
  return {1, activeSessionCount}
`;
const REFRESH_HEARTBEAT_SCRIPT = `
  local sessionKey = KEYS[1]
  local expiresAtFieldName = ARGV[1]
  local expiresAtIso = ARGV[2]
  local sessionTtlSeconds = tonumber(ARGV[3])

  if redis.call('EXISTS', sessionKey) == 0 then
    return 0
  end

  redis.call('HSET', sessionKey, expiresAtFieldName, expiresAtIso)
  redis.call('EXPIRE', sessionKey, sessionTtlSeconds)
  return 1
`;
const CLEANUP_SESSION_SCRIPT = `
  local sessionKey = KEYS[1]
  local userSessionSetKey = KEYS[2]
  local lastSeenStorageKey = KEYS[3]
  local sessionId = ARGV[1]
  local lastSeenIso = ARGV[2]

  redis.call('DEL', sessionKey)
  local removedSessionCount = redis.call('SREM', userSessionSetKey, sessionId)
  local activeSessionCount = redis.call('SCARD', userSessionSetKey)
  redis.call('SET', lastSeenStorageKey, lastSeenIso)

  if removedSessionCount == 1 and activeSessionCount == 0 then
    return 1
  end
  return 0
`;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
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
    const { sessionId, activeSessionCount } =
      await this.registerConnectionWithCollisionRetry(tenantId, userId);
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
    const scriptResult = await redisClient.eval(
      REFRESH_HEARTBEAT_SCRIPT,
      1,
      sessionStorageKey,
      SESSION_HASH_EXPIRES_AT_FIELD,
      updatedExpiresAt,
      String(SESSION_TTL_SECONDS),
    );
    return this.readNumericScriptResult(scriptResult) === 1;
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
    const cleanupScriptResult = await redisClient.eval(
      CLEANUP_SESSION_SCRIPT,
      3,
      sessionStorageKey,
      userSessionSetKey,
      lastSeenKey(identity.tenantId, identity.userId),
      sessionId,
      nowIso,
    );
    this.sessionIdentityBySessionId.delete(sessionId);
    this.publishTransitionEvent(
      this.readNumericScriptResult(cleanupScriptResult) === 1,
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

  private async registerConnectionWithCollisionRetry(
    tenantId: string,
    userId: string,
  ): Promise<{ sessionId: string; activeSessionCount: number }> {
    for (
      let collisionRetryCount = 0;
      collisionRetryCount <= SESSION_COLLISION_RETRY_LIMIT;
      collisionRetryCount += 1
    ) {
      const sessionId = randomUUID();
      const registerResult = await this.tryRegisterSession(
        sessionId,
        tenantId,
        userId,
      );
      if (registerResult.created) {
        return {
          sessionId,
          activeSessionCount: registerResult.activeSessionCount,
        };
      }

      this.logger.warn(
        `Detected session id collision for ${sessionId}; retrying registration.`,
      );
    }

    throw new Error('Unable to allocate a unique session id.');
  }

  private async tryRegisterSession(
    sessionId: string,
    tenantId: string,
    userId: string,
  ): Promise<{ created: boolean; activeSessionCount: number }> {
    const sessionStorageKey = sessionKey(sessionId);
    const userSessionSetKey = userSessionsKey(tenantId, userId);
    const expiresAtIso = this.createSessionExpiryTimestamp();
    const scriptResult = await redisClient.eval(
      REGISTER_SESSION_SCRIPT,
      2,
      sessionStorageKey,
      userSessionSetKey,
      sessionId,
      userId,
      tenantId,
      expiresAtIso,
      String(SESSION_TTL_SECONDS),
    );
    const parsedResult = this.readSessionRegistrationResult(scriptResult);
    return {
      created: parsedResult.created === 1,
      activeSessionCount: parsedResult.activeSessionCount,
    };
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

  private readSessionRegistrationResult(reply: unknown): {
    created: number;
    activeSessionCount: number;
  } {
    if (!Array.isArray(reply) || reply.length < 2) {
      throw new Error(
        'Redis registration script returned an invalid response.',
      );
    }

    const created = Number(reply[0]);
    const activeSessionCount = Number(reply[1]);
    if (!Number.isInteger(created) || !Number.isInteger(activeSessionCount)) {
      throw new Error(
        'Redis registration script returned non-integer responses.',
      );
    }
    return { created, activeSessionCount };
  }

  private readNumericScriptResult(reply: unknown): number {
    const numericResult = Number(reply);
    if (!Number.isInteger(numericResult)) {
      throw new Error('Redis script returned a non-integer response.');
    }
    return numericResult;
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
