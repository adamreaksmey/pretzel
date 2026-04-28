declare module '@pretzel/redis' {
  import type { Redis } from 'ioredis';

  export const redisClient: Redis;
  export function sessionKey(sessionId: string): string;
  export function userSessionsKey(tenantId: string, userId: string): string;
  export function lastSeenKey(tenantId: string, userId: string): string;
  export function typingKey(tenantId: string, userId: string): string;
}
