export const redisClient = {
  scard: () => Promise.resolve(0),
  get: () => Promise.resolve<string | null>(null),
};

export function userSessionsKey(tenantId: string, userId: string): string {
  return `user_sessions:${tenantId}:${userId}`;
}

export function lastSeenKey(tenantId: string, userId: string): string {
  return `last_seen:${tenantId}:${userId}`;
}
