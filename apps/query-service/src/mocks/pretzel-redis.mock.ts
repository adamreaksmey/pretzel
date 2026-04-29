export const redisClient = {
  scard: () => Promise.resolve(0),
  smembers: () => Promise.resolve<string[]>([]),
  get: () => Promise.resolve<string | null>(null),
  pipeline: () => ({
    exists: () => undefined,
    exec: () => Promise.resolve<Array<[Error | null, unknown]>>([]),
  }),
};

export function userSessionsKey(tenantId: string, userId: string): string {
  return `user_sessions:${tenantId}:${userId}`;
}

export function lastSeenKey(tenantId: string, userId: string): string {
  return `last_seen:${tenantId}:${userId}`;
}

export function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}
