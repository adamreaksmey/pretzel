import { Injectable } from '@nestjs/common';
import { lastSeenKey, redisClient, userSessionsKey } from '@pretzel/redis';
import type { UserPresence } from '@pretzel/types';

interface PresenceReadRedisClient {
  scard(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
}

const typedRedisClient = redisClient as unknown as PresenceReadRedisClient;

@Injectable()
export class PresenceService {
  async getPresence(tenantId: string, userId: string): Promise<UserPresence> {
    const [sessionCount, lastSeen] = await Promise.all([
      typedRedisClient.scard(userSessionsKey(tenantId, userId)),
      typedRedisClient.get(lastSeenKey(tenantId, userId)),
    ]);

    console.log('show sessioncount, last seen', [sessionCount, lastSeen]);

    return {
      userId,
      status: sessionCount > 0 ? 'online' : 'offline',
      last_seen: lastSeen,
    };
  }

  getPresenceBatch(
    tenantId: string,
    userIds: string[],
  ): Promise<UserPresence[]> {
    return Promise.all(
      userIds.map((userId) => this.getPresence(tenantId, userId)),
    );
  }
}
