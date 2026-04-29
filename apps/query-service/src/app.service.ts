import { Injectable, Logger } from '@nestjs/common';
import {
  lastSeenKey,
  redisClient,
  sessionKey,
  userSessionsKey,
} from '@pretzel/redis';
import type { UserPresence } from '@pretzel/types';

interface PresenceReadRedisClient {
  scard(key: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
  pipeline(): {
    scard(key: string): unknown;
    exists(key: string): unknown;
    get(key: string): unknown;
    exec(): Promise<Array<[Error | null, unknown]>>;
  };
}

const typedRedisClient = redisClient as unknown as PresenceReadRedisClient;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  async getPresence(tenantId: string, userId: string): Promise<UserPresence> {
    const userSessionSetStorageKey = userSessionsKey(tenantId, userId);
    const [sessionCount, lastSeen] = await this.withRedisTimeout(
      'read single-user presence',
      () =>
        Promise.all([
          typedRedisClient.scard(userSessionSetStorageKey),
          typedRedisClient.get(lastSeenKey(tenantId, userId)),
        ]),
    );
    if (sessionCount === 0) {
      return {
        userId,
        status: 'offline',
        last_seen: lastSeen,
      };
    }

    const hasActiveSession = await this.hasAnyActiveSession(
      userSessionSetStorageKey,
    );

    return {
      userId,
      status: hasActiveSession ? 'online' : 'offline',
      last_seen: lastSeen,
    };
  }

  async getPresenceBatch(
    tenantId: string,
    userIds: string[],
  ): Promise<UserPresence[]> {
    if (userIds.length === 0) {
      return [];
    }

    const redisPipeline = typedRedisClient.pipeline();
    userIds.forEach((userId) => {
      redisPipeline.scard(userSessionsKey(tenantId, userId));
      redisPipeline.get(lastSeenKey(tenantId, userId));
    });

    const pipelineReplies = await this.withRedisTimeout(
      'read batch presence pipeline',
      () => redisPipeline.exec(),
    );
    return userIds.map((userId, userIndex) => {
      const sessionCountReply = pipelineReplies[userIndex * 2];
      const lastSeenReply = pipelineReplies[userIndex * 2 + 1];
      const sessionCount = this.readPipelineNumber(sessionCountReply);
      const lastSeen = this.readPipelineStringOrNull(lastSeenReply);
      return {
        userId,
        status: sessionCount > 0 ? 'online' : 'offline',
        last_seen: lastSeen,
      };
    });
  }

  private readPipelineNumber(
    reply: [Error | null, unknown] | undefined,
  ): number {
    if (!reply || reply[0] !== null) {
      throw new Error('Redis pipeline numeric reply is invalid.');
    }

    return Number(reply[1] ?? 0);
  }

  private readPipelineStringOrNull(
    reply: [Error | null, unknown] | undefined,
  ): string | null {
    if (!reply || reply[0] !== null) {
      throw new Error('Redis pipeline string reply is invalid.');
    }

    if (typeof reply[1] === 'string') {
      return reply[1];
    }
    return null;
  }

  private async hasAnyActiveSession(
    userSessionSetStorageKey: string,
  ): Promise<boolean> {
    const sessionIds = await this.withRedisTimeout(
      'read single-user session ids',
      () => typedRedisClient.smembers(userSessionSetStorageKey),
    );
    if (sessionIds.length === 0) {
      return false;
    }

    const existencePipeline = typedRedisClient.pipeline();
    sessionIds.forEach((sessionId) => {
      existencePipeline.exists(sessionKey(sessionId));
    });
    const existenceReplies = await this.withRedisTimeout(
      'read single-user active session existence',
      () => existencePipeline.exec(),
    );
    return existenceReplies.some((reply) => this.readPipelineNumber(reply) > 0);
  }

  private async withRedisTimeout<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const redisTimeoutMs = 3000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Redis operation timed out: ${operationName}`));
      }, redisTimeoutMs);
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
}
