jest.mock('@pretzel/redis', () => {
  return {
    redisClient: {
      scard: jest.fn(),
      get: jest.fn(),
    },
    userSessionsKey: (tenantId: string, userId: string) =>
      `user_sessions:${tenantId}:${userId}`,
    lastSeenKey: (tenantId: string, userId: string) =>
      `last_seen:${tenantId}:${userId}`,
  };
});

import { AppService } from './app.service';
import { redisClient } from '@pretzel/redis';

type RedisReadClient = {
  scard: jest.Mock<Promise<number>, [string]>;
  get: jest.Mock<Promise<string | null>, [string]>;
};

describe('AppService reliability', () => {
  const redisReadClient = redisClient as unknown as RedisReadClient;
  let appService: AppService;

  beforeEach(() => {
    appService = new AppService();
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const tenantAPresence = await appService.getPresence(
      'tenant-a',
      'shared-user',
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
