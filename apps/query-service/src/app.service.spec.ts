jest.mock('@pretzel/redis', () => {
  return {
    redisClient: {
      scard: jest.fn(),
      smembers: jest.fn(),
      get: jest.fn(),
      pipeline: jest.fn(),
    },
    userSessionsKey: (tenantId: string, userId: string) =>
      `user_sessions:${tenantId}:${userId}`,
    sessionKey: (sessionId: string) => `session:${sessionId}`,
    lastSeenKey: (tenantId: string, userId: string) =>
      `last_seen:${tenantId}:${userId}`,
  };
});

import { PresenceService } from './app.service';
import { redisClient } from '@pretzel/redis';

type RedisReadClient = {
  scard: jest.Mock<Promise<number>, [string]>;
  smembers: jest.Mock<Promise<string[]>, [string]>;
  get: jest.Mock<Promise<string | null>, [string]>;
  pipeline: jest.Mock<
    {
      exists: jest.Mock<unknown, [string]>;
      exec: jest.Mock<Promise<Array<[Error | null, unknown]>>, []>;
    },
    []
  >;
};

describe('AppService reliability', () => {
  const redisReadClient = redisClient as unknown as RedisReadClient;
  let appService: PresenceService;

  beforeEach(() => {
    appService = new PresenceService();
    jest.clearAllMocks();
  });

  it('isolates tenant reads for the same user id', async () => {
    redisReadClient.scard.mockImplementation((key: string) => {
      if (key === 'user_sessions:tenant-a:shared-user') {
        return Promise.resolve(1);
      }
      if (key === 'user_sessions:tenant-b:shared-user') {
        return Promise.resolve(0);
      }
      return Promise.resolve(0);
    });
    redisReadClient.get.mockImplementation((key: string) => {
      if (key === 'last_seen:tenant-a:shared-user') {
        return Promise.resolve(null);
      }
      if (key === 'last_seen:tenant-b:shared-user') {
        return Promise.resolve('2026-01-01T00:00:00.000Z');
      }
      return Promise.resolve(null);
    });
    redisReadClient.smembers.mockImplementation((key: string) => {
      if (key === 'user_sessions:tenant-a:shared-user') {
        return Promise.resolve(['session-a']);
      }
      if (key === 'user_sessions:tenant-b:shared-user') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    redisReadClient.pipeline.mockImplementation(() => {
      const existsCalls: string[] = [];
      const exists = jest.fn<unknown, [string]>((key: string) => {
        existsCalls.push(key);
        return undefined;
      });
      const exec = jest.fn<Promise<Array<[Error | null, unknown]>>, []>(() =>
        Promise.resolve(
          existsCalls.map((key) => [null, key === 'session:session-a' ? 1 : 0]),
        ),
      );
      return { exists, exec };
    });

    const tenantAPresence = await appService.getPresence(
      'tenant-a',
      'shared-user',
    );

    const tenantBPresence = await appService.getPresence(
      'tenant-b',
      'shared-user',
    );

    expect(tenantAPresence).toEqual({
      userId: 'shared-user',
      status: 'online',
      last_seen: null,
    });
    expect(tenantBPresence).toEqual({
      userId: 'shared-user',
      status: 'offline',
      last_seen: '2026-01-01T00:00:00.000Z',
    });
    expect(redisReadClient.scard).toHaveBeenCalledWith(
      'user_sessions:tenant-a:shared-user',
    );
    expect(redisReadClient.scard).toHaveBeenCalledWith(
      'user_sessions:tenant-b:shared-user',
    );
  });
});
