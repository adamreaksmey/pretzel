# Pretzel Presence PaaS

Pretzel is a multi-tenant presence platform for developer-facing products.  
It provides deterministic online/offline status, last seen timestamps, and ephemeral typing indicators.

## What Is Implemented

- Deterministic presence model: user is `online` when at least one active session exists, otherwise `offline`
- Multi-session support across tabs/devices
- Session heartbeat and TTL cleanup flow
- Typing lifecycle with short TTL and expiry-driven `typing_stop`
- Tenant-scoped REST query API
- TypeScript SDK and React hooks package
- Shared Redis key helpers and shared contracts package
- Reliability-focused unit tests for transition, TTL, typing expiry, idempotency, and tenant isolation

## Monorepo Layout

```text
apps/
  ws-service/        WebSocket presence ingestion + event broadcasting
  query-service/     REST read API for presence state
packages/
  types/             Shared contracts used across services/SDKs
  sdk/               JS/TS SDK client
  sdk-react/         React hooks wrapper around sdk
libs/
  redis/             Shared Redis client and key helpers
```

## Core Behavior

- Presence source of truth: Redis
- Session key: `session:{session_id}` with 30s TTL
- User sessions set: `user_sessions:{tenant_id}:{user_id}`
- Last seen key: `last_seen:{tenant_id}:{user_id}`
- Typing key: `typing:{tenant_id}:{user_id}` with 3s TTL
- Keyspace notification requirement: `notify-keyspace-events` includes `Ex`

## Service Endpoints

### Query Service (`apps/query-service`)

- Base URL: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`
- `GET /presence/:userId`
- `POST /presence/batch`
- Tenant scope via either:
  - `x-tenant-id` header
  - `x-api-key` header in format `tenant:<tenantId>`

### WS Service (`apps/ws-service`)

- Base URL: `http://localhost:3001`
- Swagger: `http://localhost:3001/docs` (minimal HTTP surface)
- WebSocket lifecycle:
  - Connect auth fields: `apiKey`, `userId`
  - Server emits: `session_assigned`
  - Client emits: `ping` every 15s
  - Client emits: `startTyping`, `stopTyping`
  - Server events: `user_online`, `user_offline`, `typing_start`, `typing_stop`

## For Developers (SDK Consumers)

Use `@pretzel/sdk` for direct integration and `@pretzel/sdk-react` for React apps.

### SDK example

```ts
import { PresenceClient } from "@pretzel/sdk";

const client = new PresenceClient();
client.connect({
  url: "ws://localhost:3001",
  apiKey: "tenant:acme",
  userId: "user-123",
});

const unsubscribe = client.subscribeToUser("user-456", (event) => {
  console.log(event.type, event.userId);
});
```

### React hooks example

```tsx
import { PresenceProvider, usePresence } from "@pretzel/sdk-react";

function Badge({ userId }: { userId: string }) {
  const presence = usePresence(userId);
  return <span>{presence.status}</span>;
}
```

## For Contributors

### Requirements

- Node.js 20+ recommended for NestJS 11 tooling
- Redis running locally (default `redis://localhost:6379`)
- Redis keyspace notifications enabled to include `Ex`

### Install

```bash
npm install
```

### Run services

```bash
# query-service
npm run start:dev -w query-service

# ws-service
npm run start:dev -w @pretzel/ws-service
```

### Workspace checks

```bash
npm run lint
npm run typecheck
npm run build
```

### Targeted tests

```bash
# ws reliability tests
npm test -w @pretzel/ws-service -- --runInBand presence.service.spec.ts

# query tenant-isolation tests
npm test -w query-service -- --runInBand app.service.spec.ts
```

## Scope Notes

Pretzel intentionally stays minimal: no analytics dashboard, no multi-region orchestration, and no non-deterministic presence logic.
