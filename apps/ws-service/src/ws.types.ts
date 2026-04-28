import type { PresenceEvent } from '@pretzel/types';

export interface SessionIdentity {
  tenantId: string;
  userId: string;
}

export interface ConnectionContext extends SessionIdentity {
  sessionId: string;
}

export interface ConnectionAuthPayload {
  apiKey?: unknown;
  userId?: unknown;
}

export interface TenantPresenceEvent extends PresenceEvent {
  targetUserId: string;
}
