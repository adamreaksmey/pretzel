import type { PresenceEvent, UserPresence } from "@pretzel/types";
import { io, type Socket } from "socket.io-client";
import {
  API_KEY_HEADER,
  EVENT_TYPING_START,
  EVENT_TYPING_STOP,
  EVENT_USER_OFFLINE,
  EVENT_USER_ONLINE,
  HEARTBEAT_INTERVAL_MS,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  PRESENCE_BATCH_PATH,
  SOCKET_EVENT_CONNECT,
  SOCKET_EVENT_CONNECT_ERROR,
  SOCKET_EVENT_DISCONNECT,
  SOCKET_EVENT_PING,
  SOCKET_EVENT_START_TYPING,
  SOCKET_EVENT_STOP_TYPING,
  TENANT_API_KEY_PREFIX,
  TENANT_ID_HEADER,
} from "./constants.js";

export interface ConnectOptions {
  url: string;
  apiKey: string;
  userId: string;
}

export type PresenceSubscription = (presenceEvent: PresenceEvent) => void;

type PresenceEventType =
  | typeof EVENT_USER_ONLINE
  | typeof EVENT_USER_OFFLINE
  | typeof EVENT_TYPING_START
  | typeof EVENT_TYPING_STOP;

interface EventWithTargetUser extends PresenceEvent {
  targetUserId?: string;
}

export class PresenceClient {
  private socket: Socket | null = null;
  private activeOptions: ConnectOptions | null = null;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private shouldReconnect = false;
  private readonly subscriptions = new Map<string, Set<PresenceSubscription>>();

  connect(options: ConnectOptions): void {
    this.activeOptions = options;
    this.shouldReconnect = true;
    this.connectSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.clearReconnectTimeout();
    this.socket?.disconnect();
    this.socket = null;
  }

  subscribeToUser(
    userId: string,
    callback: PresenceSubscription,
  ): () => void {
    const normalizedUserId = this.normalizeRequiredValue(userId, "userId");
    const userSubscriptions =
      this.subscriptions.get(normalizedUserId) ?? new Set<PresenceSubscription>();
    userSubscriptions.add(callback);
    this.subscriptions.set(normalizedUserId, userSubscriptions);
    return () => {
      this.removeSubscription(normalizedUserId, callback);
    };
  }

  async getPresence(userId: string): Promise<UserPresence> {
    const normalizedUserId = this.normalizeRequiredValue(userId, "userId");
    const response = await this.requestJson<UserPresence>(
      `/presence/${encodeURIComponent(normalizedUserId)}`,
      { method: "GET" },
    );
    return response;
  }

  async getPresenceBatch(userIds: string[]): Promise<UserPresence[]> {
    const normalizedUserIds = this.normalizeUserIds(userIds);
    return this.requestJson<UserPresence[]>(PRESENCE_BATCH_PATH, {
      method: "POST",
      body: JSON.stringify({ userIds: normalizedUserIds }),
    });
  }

  startTyping(userId: string): void {
    const normalizedUserId = this.normalizeRequiredValue(userId, "userId");
    this.emitSocketEvent(SOCKET_EVENT_START_TYPING, { userId: normalizedUserId });
  }

  stopTyping(userId: string): void {
    const normalizedUserId = this.normalizeRequiredValue(userId, "userId");
    this.emitSocketEvent(SOCKET_EVENT_STOP_TYPING, { userId: normalizedUserId });
  }

  private connectSocket(): void {
    const options = this.requireActiveOptions();
    this.socket?.disconnect();
    this.socket = io(options.url, {
      autoConnect: true,
      reconnection: false,
      auth: { apiKey: options.apiKey, userId: options.userId },
    });
    this.bindSocketLifecycle();
    this.bindPresenceEvents();
  }

  private bindSocketLifecycle(): void {
    if (!this.socket) {
      return;
    }

    this.socket.on(SOCKET_EVENT_CONNECT, () => {
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      this.startHeartbeat();
    });
    this.socket.on(SOCKET_EVENT_DISCONNECT, () => {
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
    this.socket.on(SOCKET_EVENT_CONNECT_ERROR, () => {
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
  }

  private bindPresenceEvents(): void {
    if (!this.socket) {
      return;
    }

    const presenceEventTypes: PresenceEventType[] = [
      EVENT_USER_ONLINE,
      EVENT_USER_OFFLINE,
      EVENT_TYPING_START,
      EVENT_TYPING_STOP,
    ];
    presenceEventTypes.forEach((eventType) => {
      this.socket?.on(eventType, (presenceEvent: EventWithTargetUser) => {
        this.dispatchPresenceEvent(presenceEvent);
      });
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatIntervalId = setInterval(() => {
      this.emitSocketEvent(SOCKET_EVENT_PING, undefined);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatIntervalId) {
      return;
    }

    clearInterval(this.heartbeatIntervalId);
    this.heartbeatIntervalId = null;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimeoutId || !this.activeOptions) {
      return;
    }

    const reconnectDelayMs = this.reconnectDelayMs;
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.connectSocket();
    }, reconnectDelayMs);
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      MAX_RECONNECT_DELAY_MS,
    );
  }

  private clearReconnectTimeout(): void {
    if (!this.reconnectTimeoutId) {
      return;
    }

    clearTimeout(this.reconnectTimeoutId);
    this.reconnectTimeoutId = null;
  }

  private dispatchPresenceEvent(presenceEvent: EventWithTargetUser): void {
    const targetUserId = this.resolveEventUserId(presenceEvent);
    if (!targetUserId) {
      return;
    }

    const subscribedCallbacks = this.subscriptions.get(targetUserId);
    if (!subscribedCallbacks) {
      return;
    }

    subscribedCallbacks.forEach((callback) => callback(presenceEvent));
  }

  private resolveEventUserId(presenceEvent: EventWithTargetUser): string | null {
    const targetUserId = this.readOptionalText(presenceEvent.targetUserId);
    if (targetUserId) {
      return targetUserId;
    }
    return this.readOptionalText(presenceEvent.userId);
  }

  private emitSocketEvent(eventName: string, payload: object | undefined): void {
    this.socket?.emit(eventName, payload);
  }

  private removeSubscription(userId: string, callback: PresenceSubscription): void {
    const userSubscriptions = this.subscriptions.get(userId);
    if (!userSubscriptions) {
      return;
    }

    userSubscriptions.delete(callback);
    if (userSubscriptions.size > 0) {
      return;
    }

    this.subscriptions.delete(userId);
  }

  private normalizeUserIds(userIds: string[]): string[] {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new Error("userIds must include at least one non-empty user id.");
    }
    return userIds.map((userId) => this.normalizeRequiredValue(userId, "userId"));
  }

  private normalizeRequiredValue(value: unknown, fieldName: string): string {
    const normalizedValue = this.readOptionalText(value);
    if (normalizedValue) {
      return normalizedValue;
    }
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  private readOptionalText(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalizedValue = value.trim();
    return normalizedValue || null;
  }

  private requireActiveOptions(): ConnectOptions {
    if (this.activeOptions) {
      return this.activeOptions;
    }
    throw new Error("connect() must be called before using the PresenceClient.");
  }

  private async requestJson<TResponse>(
    path: string,
    requestInit: RequestInit,
  ): Promise<TResponse> {
    const options = this.requireActiveOptions();
    const response = await fetch(`${this.getHttpBaseUrl(options.url)}${path}`, {
      ...requestInit,
      headers: {
        "content-type": "application/json",
        [API_KEY_HEADER]: options.apiKey,
        [TENANT_ID_HEADER]: this.resolveTenantId(options.apiKey),
      },
    });
    if (!response.ok) {
      throw new Error(`Presence request failed with status ${response.status}.`);
    }
    return (await response.json()) as TResponse;
  }

  private resolveTenantId(apiKey: string): string {
    if (!apiKey.startsWith(TENANT_API_KEY_PREFIX)) {
      throw new Error("apiKey must use tenant:<tenantId> format.");
    }
    const tenantId = apiKey.slice(TENANT_API_KEY_PREFIX.length).trim();
    if (tenantId) {
      return tenantId;
    }
    throw new Error("apiKey is missing tenant identifier.");
  }

  private getHttpBaseUrl(socketUrl: string): string {
    const normalizedUrl = new URL(socketUrl);
    const protocol = normalizedUrl.protocol === "wss:" ? "https:" : "http:";
    return `${protocol}//${normalizedUrl.host}`;
  }
}
