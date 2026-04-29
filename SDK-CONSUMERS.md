# Pretzel SDK Consumer Guide

This document covers all currently published consumer features for:
- `@adamthedeveloper/pretzel-sdk` (`0.1.2`)
- `@adamthedeveloper/pretzel-sdk-react` (`0.1.2`)

## Install

```bash
npm install @adamthedeveloper/pretzel-sdk @adamthedeveloper/pretzel-sdk-react
```

`@adamthedeveloper/pretzel-sdk-react` requires peer dependencies:
- `react` `^19.0.0`
- `react-dom` `^19.0.0`

## Package Features

### `@adamthedeveloper/pretzel-sdk`

- WebSocket connect/disconnect lifecycle
- Automatic heartbeat (`ping`) every 15 seconds
- Automatic reconnection with exponential backoff
  - initial delay: `500ms`
  - max delay: `10,000ms`
- Per-user event subscriptions with explicit unsubscribe
- Presence read APIs:
  - `getPresence(userId)`
  - `getPresenceBatch(userIds)`
- Typing APIs:
  - `startTyping(userId)`
  - `stopTyping(userId)`
- Event dispatch support for:
  - `user_online`
  - `user_offline`
  - `typing_start`
  - `typing_stop`
- Tenant-safe request headers derived from `apiKey`

### `@adamthedeveloper/pretzel-sdk-react`

- `PresenceProvider` for sharing one `PresenceClient` instance
- `usePresenceClient()` for direct client access in components
- `usePresence(userId)` for single-user reactive presence state
- `usePresenceBatch(userIds)` for multi-user reactive presence map
- `useTyping(userId)` for reactive typing status
- Built-in stale-event protection using event timestamps for:
  - `usePresence`
  - `useTyping`
- Automatic subscribe/unsubscribe lifecycle inside hooks

## Core Types

```ts
type PresenceStatus = "online" | "offline";

type UserPresence = {
  userId: string;
  status: PresenceStatus;
  last_seen: string | null;
};

type PresenceEvent = {
  type: "user_online" | "user_offline" | "typing_start" | "typing_stop";
  userId: string;
  tenantId: string;
  timestamp: string;
};
```

## SDK API Reference

### Create client

```ts
import { PresenceClient } from "@adamthedeveloper/pretzel-sdk";

const client = new PresenceClient();
```

### `connect(options)`

```ts
client.connect({
  url: "ws://localhost:3001",
  apiKey: "<keyId>.<secret>",
  userId: "user-123",
});
```

- `url`: WebSocket base URL
- `apiKey`: issued presented API key in `<keyId>.<secret>` format
- `userId`: current connected user

### `disconnect()`

Stops heartbeat and reconnection attempts, removes listeners, and disconnects the socket.

### `subscribeToUser(userId, callback)`

```ts
const unsubscribe = client.subscribeToUser("user-456", (event) => {
  console.log(event.type, event.timestamp);
});
```

- Each call creates an independent subscription
- Always call `unsubscribe()` during cleanup to avoid leaks

### `getPresence(userId)`

```ts
const presence = await client.getPresence("user-456");
```

Returns:

```ts
{
  userId: "user-456",
  status: "online" | "offline",
  last_seen: string | null
}
```

### `getPresenceBatch(userIds)`

```ts
const presenceList = await client.getPresenceBatch(["user-1", "user-2"]);
```

Returns `UserPresence[]`.

### `startTyping(userId)` / `stopTyping(userId)`

```ts
client.startTyping("user-456");
client.stopTyping("user-456");
```

## React API Reference

### `PresenceProvider`

```tsx
import { PresenceClient } from "@adamthedeveloper/pretzel-sdk";
import { PresenceProvider } from "@adamthedeveloper/pretzel-sdk-react";

const client = new PresenceClient();

client.connect({
  url: "ws://localhost:3001",
  apiKey: "<keyId>.<secret>",
  userId: "user-123",
});

export function AppRoot() {
  return <PresenceProvider client={client}>{/* app */}</PresenceProvider>;
}
```

### `usePresenceClient()`

Returns the `PresenceClient` from context.  
Throws if used outside `PresenceProvider`.

### `usePresence(userId)`

```tsx
const presence = usePresence("user-456");
// { status: "online" | "offline", last_seen: string | null }
```

Behavior:
- Fetches initial state via `getPresence`
- Subscribes to real-time presence events
- Ignores out-of-order stale events using timestamps

### `usePresenceBatch(userIds)`

```tsx
const presenceByUserId = usePresenceBatch(["user-1", "user-2"]);
// Record<string, { status: "online" | "offline"; last_seen: string | null }>
```

Behavior:
- Fetches initial batch via `getPresenceBatch`
- Creates one live subscription per user ID
- Returns `{}` for an empty input list

### `useTyping(userId)`

```tsx
const { isTyping } = useTyping("user-456");
```

Behavior:
- Listens to `typing_start` / `typing_stop`
- Ignores stale events using timestamps
- Resets to `isTyping: false` on cleanup

## End-to-End Usage Example

```tsx
import { useEffect } from "react";
import { PresenceClient } from "@adamthedeveloper/pretzel-sdk";
import {
  PresenceProvider,
  usePresence,
  useTyping,
  usePresenceClient,
} from "@adamthedeveloper/pretzel-sdk-react";

const client = new PresenceClient();

client.connect({
  url: "ws://localhost:3001",
  apiKey: "<keyId>.<secret>",
  userId: "viewer-user",
});

function UserPresenceCard({ userId }: { userId: string }) {
  const presence = usePresence(userId);
  const { isTyping } = useTyping(userId);
  const sdkClient = usePresenceClient();

  useEffect(() => {
    sdkClient.startTyping(userId);
    return () => {
      sdkClient.stopTyping(userId);
    };
  }, [sdkClient, userId]);

  return (
    <div>
      <div>{userId}</div>
      <div>Status: {presence.status}</div>
      <div>Last seen: {presence.last_seen ?? "never"}</div>
      <div>Typing: {isTyping ? "yes" : "no"}</div>
    </div>
  );
}

export function App() {
  return (
    <PresenceProvider client={client}>
      <UserPresenceCard userId="target-user" />
    </PresenceProvider>
  );
}
```

## Error and Input Notes

- `connect()` must be called before HTTP presence reads
- `apiKey` must be `<keyId>.<secret>`
- `userId` must be a non-empty string
- `getPresenceBatch(userIds)` requires at least one user ID
- Non-2xx presence HTTP responses throw an error
- `usePresenceClient()` throws if no `PresenceProvider` is present

## Service Expectations

- WS service should be reachable at your configured `url`
- Query API is inferred from WS URL host:
  - `ws://host` -> `http://host`
  - `wss://host` -> `https://host`
- Presence read requests (`getPresence`, `getPresenceBatch`) are sent to that inferred HTTP base URL

For platform setup and architecture details, see [`README.md`](./README.md).
