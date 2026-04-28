declare module '@pretzel/types' {
  export type PresenceStatus = 'online' | 'offline';

  export interface UserPresence {
    userId: string;
    status: PresenceStatus;
    last_seen: string | null;
  }

  export interface PresenceEvent {
    type: 'user_online' | 'user_offline' | 'typing_start' | 'typing_stop';
    userId: string;
    tenantId: string;
    timestamp: string;
  }

  export interface SessionMeta {
    sessionId: string;
    userId: string;
    tenantId: string;
    expiresAt: string;
  }
}

declare module '@pretzel/redis' {
  import type Redis from 'ioredis';

  export const redisClient: Redis;
  export function createRedisClient(redisUrl?: string): Redis;
  export function getRedisClient(): Redis;
  export function sessionKey(sessionId: string): string;
  export function userSessionsKey(tenantId: string, userId: string): string;
  export function lastSeenKey(tenantId: string, userId: string): string;
  export function typingKey(tenantId: string, userId: string): string;
  export function hasRequiredKeyspaceNotifications(
    setting: string | null,
  ): boolean;
  export function assertKeyspaceNotificationsEnabled(
    client?: Redis,
  ): Promise<void>;
}
