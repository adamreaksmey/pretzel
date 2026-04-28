import { Redis } from "ioredis";

const DEFAULT_REDIS_URL = "redis://localhost:6379";
const REQUIRED_KEYSPACE_FLAGS = ["E", "x"] as const;
const KEY_SEPARATOR = ":";

export const redisKeyPrefixes = {
  session: "session",
  userSessions: "user_sessions",
  lastSeen: "last_seen",
  typing: "typing"
} as const;

let sharedRedisClient: Redis | null = null;

export function createRedisClient(redisUrl?: string): Redis {
  return new Redis(redisUrl ?? process.env.REDIS_URL ?? DEFAULT_REDIS_URL);
}

export function getRedisClient(): Redis {
  if (sharedRedisClient) {
    return sharedRedisClient;
  }

  sharedRedisClient = createRedisClient();
  return sharedRedisClient;
}

export const redisClient = getRedisClient();

export function sessionKey(sessionId: string): string {
  return [redisKeyPrefixes.session, sessionId].join(KEY_SEPARATOR);
}

export function userSessionsKey(tenantId: string, userId: string): string {
  return [redisKeyPrefixes.userSessions, tenantId, userId].join(KEY_SEPARATOR);
}

export function lastSeenKey(tenantId: string, userId: string): string {
  return [redisKeyPrefixes.lastSeen, tenantId, userId].join(KEY_SEPARATOR);
}

export function typingKey(tenantId: string, userId: string): string {
  return [redisKeyPrefixes.typing, tenantId, userId].join(KEY_SEPARATOR);
}

export function hasRequiredKeyspaceNotifications(setting: string | null): boolean {
  if (!setting) {
    return false;
  }

  return REQUIRED_KEYSPACE_FLAGS.every((flag) => setting.includes(flag));
}

export async function assertKeyspaceNotificationsEnabled(
  client: Redis = redisClient
): Promise<void> {
  const notificationSetting = (await client.config(
    "GET",
    "notify-keyspace-events"
  )) as string[];
  const configuredValue = notificationSetting[1] ?? "";

  if (hasRequiredKeyspaceNotifications(configuredValue)) {
    return;
  }

  throw new Error(
    `Redis notify-keyspace-events must include ${REQUIRED_KEYSPACE_FLAGS.join("")}. Current: "${configuredValue}".`
  );
}
