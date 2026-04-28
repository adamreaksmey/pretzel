import type { SessionIdentity } from './ws.types';

type PresenceEventType =
  | 'user_online'
  | 'user_offline'
  | 'typing_start'
  | 'typing_stop';

interface PresenceEvent {
  type: PresenceEventType;
  tenantId: string;
  userId: string;
  targetUserId: string;
  timestamp: string;
}

type MessageHandler = (channel: string, key: string) => void;

const KEYSPACE_SETTING = 'Ex';

async function flushAsyncTasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

class FakeRedisClient {
  private readonly sessionFieldsBySessionKey = new Map<
    string,
    SessionIdentity
  >();
  private readonly userSessionIdsByKey = new Map<string, Set<string>>();
  private readonly typingKeys = new Set<string>();
  private readonly lastSeenByKey = new Map<string, string>();
  private readonly expiryByKey = new Map<string, number>();
  private messageHandler: MessageHandler | null = null;
  private readonly notifySetting = KEYSPACE_SETTING;

  reset(): void {
    this.sessionFieldsBySessionKey.clear();
    this.userSessionIdsByKey.clear();
    this.typingKeys.clear();
    this.lastSeenByKey.clear();
    this.expiryByKey.clear();
    this.messageHandler = null;
  }

  duplicate(): FakeRedisClient {
    return this;
  }

  subscribe(channel: string): Promise<void> {
    void channel;
    return Promise.resolve();
  }

  on(eventName: string, callback: MessageHandler): void {
    if (eventName === 'message') {
      this.messageHandler = callback;
    }
  }

  emitExpiredKey(key: string): void {
    this.messageHandler?.('__keyevent@0__:expired', key);
  }

  config(command: string, option: string): Promise<string[]> {
    void command;
    void option;
    return Promise.resolve(['notify-keyspace-events', this.notifySetting]);
  }

  multi(): FakeRedisMulti {
    return new FakeRedisMulti(this);
  }

  hgetall(key: string): Promise<Record<string, string>> {
    const identity = this.sessionFieldsBySessionKey.get(key);
    if (!identity) {
      return Promise.resolve({});
    }
    return Promise.resolve({
      tenant_id: identity.tenantId,
      user_id: identity.userId,
    });
  }

  set(
    key: string,
    value: string,
    exKeyword?: string,
    ttlSeconds?: string,
    nxKeyword?: string,
  ): Promise<'OK' | null> {
    if (nxKeyword === 'NX' && this.typingKeys.has(key)) {
      return Promise.resolve(null);
    }

    if (exKeyword === 'EX' && ttlSeconds) {
      this.expiryByKey.set(key, Number.parseInt(ttlSeconds, 10));
    }

    this.typingKeys.add(key);
    if (key.startsWith('last_seen:')) {
      this.lastSeenByKey.set(key, value);
    }
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    const deletedSession = this.sessionFieldsBySessionKey.delete(key) ? 1 : 0;
    const deletedTyping = this.typingKeys.delete(key) ? 1 : 0;
    return Promise.resolve(deletedSession || deletedTyping);
  }

  expire(key: string, ttl: string): Promise<number> {
    if (!this.sessionFieldsBySessionKey.has(key) && !this.typingKeys.has(key)) {
      return Promise.resolve(0);
    }
    this.expiryByKey.set(key, Number.parseInt(ttl, 10));
    return Promise.resolve(1);
  }

  sadd(key: string, value: string): Promise<number> {
    const existing = this.userSessionIdsByKey.get(key) ?? new Set<string>();
    existing.add(value);
    this.userSessionIdsByKey.set(key, existing);
    return Promise.resolve(existing.size);
  }

  srem(key: string, value: string): Promise<number> {
    const existing = this.userSessionIdsByKey.get(key);
    if (!existing || !existing.has(value)) {
      return Promise.resolve(0);
    }
    existing.delete(value);
    if (existing.size === 0) {
      this.userSessionIdsByKey.delete(key);
    }
    return Promise.resolve(1);
  }

  scard(key: string): Promise<number> {
    return Promise.resolve(this.userSessionIdsByKey.get(key)?.size ?? 0);
  }

  putSessionIdentity(key: string, identity: SessionIdentity): void {
    this.sessionFieldsBySessionKey.set(key, identity);
  }

  setLastSeen(key: string, value: string): void {
    this.lastSeenByKey.set(key, value);
  }
}

class FakeRedisMulti {
  private readonly commands: Array<() => Promise<unknown>> = [];

  constructor(private readonly client: FakeRedisClient) {}

  hset(
    key: string,
    field: Record<string, string> | string,
    value?: string,
  ): this {
    this.commands.push(async () => {
      if (typeof field === 'string') {
        const existingIdentity = await this.client.hgetall(key);
        const tenantId = existingIdentity.tenant_id ?? '';
        const userId = existingIdentity.user_id ?? '';
        if (field === 'tenant_id') {
          this.client.putSessionIdentity(key, {
            tenantId: value ?? '',
            userId,
          });
        }
        if (field === 'user_id') {
          this.client.putSessionIdentity(key, {
            tenantId,
            userId: value ?? '',
          });
        }
        return 1;
      }

      this.client.putSessionIdentity(key, {
        tenantId: field.tenant_id,
        userId: field.user_id,
      });
      return 3;
    });
    return this;
  }

  expire(key: string, ttl: number): this {
    this.commands.push(async () => this.client.expire(key, String(ttl)));
    return this;
  }

  sadd(key: string, value: string): this {
    this.commands.push(async () => this.client.sadd(key, value));
    return this;
  }

  srem(key: string, value: string): this {
    this.commands.push(async () => this.client.srem(key, value));
    return this;
  }

  scard(key: string): this {
    this.commands.push(async () => this.client.scard(key));
    return this;
  }

  del(key: string): this {
    this.commands.push(async () => this.client.del(key));
    return this;
  }

  set(key: string, value: string): this {
    this.commands.push(() => {
      this.client.setLastSeen(key, value);
      return Promise.resolve('OK');
    });
    return this;
  }

  async exec(): Promise<Array<[null, number | string]>> {
    const replies: Array<[null, number | string]> = [];
    for (const command of this.commands) {
      const result = await command();
      replies.push([null, result as number | string]);
    }
    return replies;
  }
}

const fakeRedisClient = new FakeRedisClient();

jest.mock('@pretzel/redis', () => {
  return {
    redisClient: fakeRedisClient,
    assertKeyspaceNotificationsEnabled: jest.fn(() =>
      Promise.resolve(undefined),
    ),
    sessionKey: (sessionId: string) => `session:${sessionId}`,
    userSessionsKey: (tenantId: string, userId: string) =>
      `user_sessions:${tenantId}:${userId}`,
    lastSeenKey: (tenantId: string, userId: string) =>
      `last_seen:${tenantId}:${userId}`,
    typingKey: (tenantId: string, userId: string) =>
      `typing:${tenantId}:${userId}`,
  };
});

describe('PresenceService reliability', () => {
  let PresenceServiceClass: typeof import('./presence.service').PresenceService;
  let presenceService: import('./presence.service').PresenceService;
  const emittedEvents: PresenceEvent[] = [];

  beforeEach(async () => {
    jest.resetModules();
    fakeRedisClient.reset();
    emittedEvents.length = 0;
    const moduleRef = await import('./presence.service');
    PresenceServiceClass = moduleRef.PresenceService;
    presenceService = new PresenceServiceClass();
    presenceService.setEventPublisher((event) => {
      emittedEvents.push(event);
    });
  });

  it('publishes online only once for multi-session and offline at 1->0', async () => {
    const firstConnection = await presenceService.registerConnection(
      'tenant-a',
      'user-a',
    );
    const secondConnection = await presenceService.registerConnection(
      'tenant-a',
      'user-a',
    );

    await presenceService.cleanupSession(firstConnection.sessionId);
    await presenceService.cleanupSession(secondConnection.sessionId);

    const eventTypes = emittedEvents.map((event) => event.type);
    expect(eventTypes).toEqual(['user_online', 'user_offline']);
  });

  it('recovers missed disconnect via session expiry listener', async () => {
    await presenceService.startExpiryListener();
    const connection = await presenceService.registerConnection(
      'tenant-b',
      'user-b',
    );

    fakeRedisClient.emitExpiredKey(`session:${connection.sessionId}`);
    await flushAsyncTasks();

    expect(emittedEvents.some((event) => event.type === 'user_offline')).toBe(
      true,
    );
  });

  it('emits typing_stop when typing key expires naturally', async () => {
    await presenceService.startExpiryListener();
    await presenceService.startTyping('tenant-c', 'user-c');

    fakeRedisClient.emitExpiredKey('typing:tenant-c:user-c');
    await flushAsyncTasks();

    const eventTypes = emittedEvents.map((event) => event.type);
    expect(eventTypes).toEqual(['typing_start', 'typing_stop']);
  });

  it('keeps heartbeat refresh idempotent while session exists', async () => {
    const connection = await presenceService.registerConnection(
      'tenant-d',
      'user-d',
    );

    const firstRefresh = await presenceService.refreshSessionHeartbeat(
      connection.sessionId,
    );
    const secondRefresh = await presenceService.refreshSessionHeartbeat(
      connection.sessionId,
    );

    expect(firstRefresh).toBe(true);
    expect(secondRefresh).toBe(true);
  });

  it('handles repeated cleanup idempotently', async () => {
    const connection = await presenceService.registerConnection(
      'tenant-e',
      'user-e',
    );

    await presenceService.cleanupSession(connection.sessionId);
    await presenceService.cleanupSession(connection.sessionId);

    const offlineEvents = emittedEvents.filter(
      (event) => event.type === 'user_offline',
    );
    expect(offlineEvents).toHaveLength(1);
  });
});
