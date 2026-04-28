import type { PresenceEvent, UserPresence } from "@pretzel/types";

export interface ConnectOptions {
  url: string;
  apiKey: string;
  userId: string;
}

export type PresenceSubscription = (presenceEvent: PresenceEvent) => void;

export class PresenceClient {
  connect(_options: ConnectOptions): void {}

  disconnect(): void {}

  subscribeToUser(
    _userId: string,
    _callback: PresenceSubscription,
  ): () => void {
    return () => {};
  }

  async getPresence(_userId: string): Promise<UserPresence> {
    return {
      userId: "",
      status: "offline",
      last_seen: null,
    };
  }

  async getPresenceBatch(_userIds: string[]): Promise<UserPresence[]> {
    return [];
  }

  startTyping(_userId: string): void {}

  stopTyping(_userId: string): void {}
}
