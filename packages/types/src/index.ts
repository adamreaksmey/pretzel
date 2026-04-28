export type PresenceStatus = "online" | "offline";

export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  last_seen: string | null;
}

export interface PresenceEvent {
  type: "user_online" | "user_offline" | "typing_start" | "typing_stop";
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
