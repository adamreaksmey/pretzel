import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PresenceClient } from "@adamthedeveloper/pretzel-sdk";
import type {
  PresenceEvent,
  PresenceStatus,
  UserPresence,
} from "@adamthedeveloper/pretzel-types";

const missingProviderErrorMessage =
  "PresenceProvider is required to use this hook";
const ONLINE_STATUS = "online";
const OFFLINE_STATUS = "offline";
const USER_ONLINE_EVENT = "user_online";
const USER_OFFLINE_EVENT = "user_offline";
const TYPING_START_EVENT = "typing_start";
const TYPING_STOP_EVENT = "typing_stop";

const PresenceClientContext = createContext<PresenceClient | null>(null);
type PresenceState = { status: PresenceStatus; last_seen: string | null };
type OrderedPresenceState = PresenceState & { lastUpdatedMs: number };
type TypingState = { isTyping: boolean; lastUpdatedMs: number };

interface PresenceProviderProps {
  client: PresenceClient;
  children: ReactNode;
}

export function PresenceProvider({ client, children }: PresenceProviderProps) {
  return (
    <PresenceClientContext.Provider value={client}>
      {children}
    </PresenceClientContext.Provider>
  );
}

export function usePresenceClient(): PresenceClient {
  const presenceClient = useContext(PresenceClientContext);
  if (presenceClient === null) {
    throw new Error(missingProviderErrorMessage);
  }
  return presenceClient;
}

export function usePresence(userId: string): PresenceState {
  const client = usePresenceClient();
  const [presence, setPresence] = useState<OrderedPresenceState>({
    status: OFFLINE_STATUS,
    last_seen: null,
    lastUpdatedMs: 0,
  });

  useEffect(() => {
    let isCancelled = false;
    void client.getPresence(userId).then((nextPresence) => {
      if (!isCancelled) {
        setPresence({
          status: nextPresence.status,
          last_seen: nextPresence.last_seen,
          lastUpdatedMs: readOptionalTimestampMs(nextPresence.last_seen),
        });
      }
    });

    const unsubscribe = client.subscribeToUser(userId, (presenceEvent) => {
      setPresence((currentPresence) =>
        updateOrderedPresenceState(currentPresence, presenceEvent),
      );
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [client, userId]);

  return useMemo(
    () => ({
      status: presence.status,
      last_seen: presence.last_seen,
    }),
    [presence.last_seen, presence.status],
  );
}

export function usePresenceBatch(
  userIds: string[],
): Record<string, PresenceState> {
  const client = usePresenceClient();
  const [presenceByUserId, setPresenceByUserId] = useState<
    Record<string, UserPresence>
  >({});
  const stableUserIds = useMemo(() => [...userIds].sort(), [userIds]);
  const userIdsSignature = stableUserIds.join(",");

  useEffect(() => {
    if (stableUserIds.length === 0) {
      setPresenceByUserId({});
      return;
    }

    let isCancelled = false;
    void client.getPresenceBatch(stableUserIds).then((presenceList) => {
      if (!isCancelled) {
        setPresenceByUserId(createPresenceRecord(presenceList));
      }
    });

    const unsubscribeList = stableUserIds.map((userId) =>
      client.subscribeToUser(userId, (presenceEvent) => {
        setPresenceByUserId((currentPresenceByUserId) =>
          updateBatchPresenceState(currentPresenceByUserId, presenceEvent),
        );
      }),
    );

    return () => {
      isCancelled = true;
      unsubscribeList.forEach((unsubscribe) => unsubscribe());
    };
  }, [client, stableUserIds, userIdsSignature]);

  return useMemo(
    () => createPresenceStateRecord(presenceByUserId),
    [presenceByUserId],
  );
}

export function useTyping(userId: string): { isTyping: boolean } {
  const client = usePresenceClient();
  const [typingState, setTypingState] = useState<TypingState>({
    isTyping: false,
    lastUpdatedMs: 0,
  });

  useEffect(() => {
    const unsubscribe = client.subscribeToUser(userId, (presenceEvent) => {
      setTypingState((currentTypingState) =>
        updateTypingState(currentTypingState, presenceEvent),
      );
    });

    return () => {
      unsubscribe();
      setTypingState({ isTyping: false, lastUpdatedMs: 0 });
    };
  }, [client, userId]);

  return useMemo(() => ({ isTyping: typingState.isTyping }), [typingState.isTyping]);
}

function createPresenceRecord(
  presenceList: UserPresence[],
): Record<string, UserPresence> {
  return presenceList.reduce<Record<string, UserPresence>>((record, presence) => {
    record[presence.userId] = presence;
    return record;
  }, {});
}

function updateBatchPresenceState(
  currentPresenceByUserId: Record<string, UserPresence>,
  presenceEvent: PresenceEvent,
): Record<string, UserPresence> {
  const currentPresence = currentPresenceByUserId[presenceEvent.userId];
  if (!currentPresence) {
    return currentPresenceByUserId;
  }

  const nextPresence = updatePresenceState(currentPresence, presenceEvent);
  return {
    ...currentPresenceByUserId,
    [presenceEvent.userId]: nextPresence,
  };
}

function updatePresenceState(
  currentPresence: UserPresence,
  presenceEvent: PresenceEvent,
): UserPresence {
  if (presenceEvent.type === USER_ONLINE_EVENT) {
    return {
      ...currentPresence,
      status: ONLINE_STATUS,
    };
  }

  if (presenceEvent.type === USER_OFFLINE_EVENT) {
    return {
      ...currentPresence,
      status: OFFLINE_STATUS,
      last_seen: presenceEvent.timestamp,
    };
  }

  return currentPresence;
}

function updateOrderedPresenceState(
  currentPresence: OrderedPresenceState,
  presenceEvent: PresenceEvent,
): OrderedPresenceState {
  if (presenceEvent.type !== USER_ONLINE_EVENT && presenceEvent.type !== USER_OFFLINE_EVENT) {
    return currentPresence;
  }

  const eventTimestampMs = readOptionalTimestampMs(presenceEvent.timestamp);
  if (eventTimestampMs < currentPresence.lastUpdatedMs) {
    return currentPresence;
  }

  if (presenceEvent.type === USER_ONLINE_EVENT) {
    return {
      ...currentPresence,
      status: ONLINE_STATUS,
      lastUpdatedMs: eventTimestampMs,
    };
  }

  return {
    ...currentPresence,
    status: OFFLINE_STATUS,
    last_seen: presenceEvent.timestamp ?? currentPresence.last_seen,
    lastUpdatedMs: eventTimestampMs,
  };
}

function updateTypingState(
  currentTypingState: TypingState,
  presenceEvent: PresenceEvent,
): TypingState {
  if (presenceEvent.type !== TYPING_START_EVENT && presenceEvent.type !== TYPING_STOP_EVENT) {
    return currentTypingState;
  }

  const eventTimestampMs = readOptionalTimestampMs(presenceEvent.timestamp);
  if (eventTimestampMs < currentTypingState.lastUpdatedMs) {
    return currentTypingState;
  }

  return {
    isTyping: presenceEvent.type === TYPING_START_EVENT,
    lastUpdatedMs: eventTimestampMs,
  };
}

function readOptionalTimestampMs(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }

  const parsedMilliseconds = Date.parse(value);
  if (!Number.isFinite(parsedMilliseconds)) {
    return 0;
  }

  return parsedMilliseconds;
}

function createPresenceStateRecord(
  presenceByUserId: Record<string, UserPresence>,
): Record<string, PresenceState> {
  return Object.fromEntries(
    Object.entries(presenceByUserId).map(([userId, presence]) => [
      userId,
      { status: presence.status, last_seen: presence.last_seen },
    ]),
  );
}
