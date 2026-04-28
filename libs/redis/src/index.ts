import { Redis } from "ioredis";

const defaultRedisUrl = "redis://localhost:6379";

export const redisClient = new Redis(process.env.REDIS_URL ?? defaultRedisUrl);

export const redisKeyPatterns = {
  sessionPrefix: "session",
  userSessionsPrefix: "user_sessions",
  lastSeenPrefix: "last_seen",
  typingPrefix: "typing"
} as const;

export function sessionKey(sessionId: string): string {
  return `${redisKeyPatterns.sessionPrefix}:${sessionId}`;
}

export function userSessionsKey(tenantId: string, userId: string): string {
  return `${redisKeyPatterns.userSessionsPrefix}:${tenantId}:${userId}`;
}

export function lastSeenKey(tenantId: string, userId: string): string {
  return `${redisKeyPatterns.lastSeenPrefix}:${tenantId}:${userId}`;
}

export function typingKey(tenantId: string, userId: string): string {
  return `${redisKeyPatterns.typingPrefix}:${tenantId}:${userId}`;
}
