import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PresenceClient } from "@pretzel/sdk";
import type { PresenceEvent, PresenceStatus, UserPresence } from "@pretzel/types";

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
  const [presence, setPresence] = useState<UserPresence>({
    userId,
    status: OFFLINE_STATUS,
    last_seen: null,
  });

  useEffect(() => {
    let isCancelled = false;
    void client.getPresence(userId).then((nextPresence) => {
      if (!isCancelled) {
        setPresence(nextPresence);
      }
    });

    const unsubscribe = client.subscribeToUser(userId, (presenceEvent) => {
      setPresence((currentPresence) =>
        updatePresenceState(currentPresence, presenceEvent),
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
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const unsubscribe = client.subscribeToUser(userId, (presenceEvent) => {
      if (presenceEvent.type === TYPING_START_EVENT) {
        setIsTyping(true);
        return;
      }
      if (presenceEvent.type === TYPING_STOP_EVENT) {
        setIsTyping(false);
      }
    });

    return () => {
      unsubscribe();
      setIsTyping(false);
    };
  }, [client, userId]);

  return useMemo(() => ({ isTyping }), [isTyping]);
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
