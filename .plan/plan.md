# Pretzel 🥨 — System Specification

I'm building **Pretzel**, a developer-focused online presence platform as a multi-tenant PaaS.

The system must be simple, deterministic, and production-safe.
Do NOT overengineer. Do NOT add features outside this specification.

---

## CORE FEATURES

The platform must support:

- Detect whether a user is online or offline
- Retrieve current online status of a user
- Retrieve last seen timestamp of a user
- Provide presence state: `"online"` | `"offline"`
- Detect and broadcast typing status (ephemeral)

---

## CORE BEHAVIOR RULES

- A user is considered ONLINE if at least one active session exists
- A user is OFFLINE if no active sessions exist
- Each connection = one session identified by a `session_id`
- `session_id` is generated server-side on connection (UUID v4)
- Users may have multiple concurrent sessions (multi-tab / multi-device)
- Presence state must be deterministic (no guessing, no AI logic)

---

## MONOREPO STRUCTURE

Use Turborepo as the monorepo tool.

```
presence-paas/
├── apps/
│   ├── ws-service/        ← NestJS WebSocket service (real-time, heartbeat)
│   └── query-service/     ← NestJS REST API (read/query presence)
├── packages/
│   ├── sdk/               ← JS/TS client SDK (npm publishable)
│   ├── sdk-react/         ← React hooks wrapper (npm publishable)
│   └── types/             ← shared interfaces and DTOs
└── libs/
    └── redis/             ← shared Redis client and key helpers
```

---

## TECH STACK

- Monorepo tool: Turborepo
- Backend framework: NestJS (Node.js)
- Transport: WebSocket (real-time presence)
- API: REST (querying presence)
- Data store: Redis (source of truth)
- SDK language: TypeScript
- SDK build tool: tsup (ESM + CJS dual output)

---

## WEBSOCKET SERVICE — apps/ws-service

### Responsibilities

- Handle client WebSocket connections and disconnections
- Generate and assign a `session_id` (UUID v4) per connection server-side
- Track active sessions per user
- Run heartbeat mechanism:
  - Client sends a `ping` event every **15 seconds**
  - Server resets session TTL to **30 seconds** on each ping received
  - If no ping is received within 30 seconds, the session key expires in Redis
- Detect stale sessions via Redis TTL expiry (keyspace notifications)
- Emit the following WebSocket events to subscribed clients:
  - `user_online` — fired when a user's session count goes from 0 → 1
  - `user_offline` — fired when a user's session count goes from 1 → 0
  - `typing_start` — fired when typing key is set
  - `typing_stop` — fired when typing key expires (via keyspace notification)

### Rules

- On disconnect: immediately remove the session from Redis atomically
- On session TTL expiry: trigger the same cleanup as an explicit disconnect
- `user_online` and `user_offline` must only fire on actual state transitions, not on every session change
- Presence updates must be atomic (use Redis MULTI/EXEC where needed)
- Keyspace notifications must be enabled: `notify-keyspace-events Ex`
- When a typing key expires naturally via TTL, the server must publish a `typing_stop` event to subscribed clients

---

## QUERY SERVICE — apps/query-service

### Responsibilities

- Expose a read-optimized REST API for querying presence state
- Must be stateless and simple — reads from Redis only

### Endpoints

```
GET  /presence/:userId
```
Returns:
```json
{
  "userId": "string",
  "status": "online" | "offline",
  "last_seen": "ISO 8601 timestamp | null"
}
```

```
POST /presence/batch
```
Request body:
```json
{
  "userIds": ["string"]
}
```
Returns:
```json
[
  {
    "userId": "string",
    "status": "online" | "offline",
    "last_seen": "ISO 8601 timestamp | null"
  }
]
```

### Rules

- All endpoints require a `tenant_id` (from API key or request header)
- No cross-tenant data access
- Return `status: "offline"` if no sessions exist for the user
- Return `last_seen: null` if the user has never been seen

---

## REDIS DESIGN — libs/redis

Redis is the single source of truth. All keys must be namespaced by `tenant_id`.

### Key Structure

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `session:{session_id}` | Hash | 30s | Session metadata |
| `user_sessions:{tenant_id}:{user_id}` | Set | none | Active session IDs for a user |
| `last_seen:{tenant_id}:{user_id}` | String | none | ISO 8601 timestamp |
| `typing:{tenant_id}:{user_id}` | String | 3–5s | Ephemeral typing indicator |

### Session Hash Fields

```
session:{session_id}
  user_id    → string
  tenant_id  → string
  expires_at → ISO 8601 timestamp
```

### Rules

- Use `EXPIRE` to set TTL on session keys
- Use `SADD` / `SREM` to manage the user sessions Set
- Use `SCARD` to determine if a user is online (count > 0 = online)
- Use atomic `MULTI/EXEC` when removing a session and checking session count
- Use keyspace notifications (`Ex`) to detect expired session and typing keys
- Avoid Lua scripts unless absolutely necessary
- The `libs/redis` package must export:
  - A shared Redis client (ioredis)
  - Key builder helpers (e.g. `sessionKey()`, `userSessionsKey()`, `lastSeenKey()`, `typingKey()`)
  - All key patterns must go through these helpers — no raw key strings elsewhere

---

## MULTI-TENANCY

- All Redis keys must include `tenant_id`
- All API endpoints must be scoped to a `tenant_id`
- No cross-tenant data access is permitted under any circumstance
- `tenant_id` is resolved from the API key on every request/connection

---

## SDK — packages/sdk

### Responsibilities

- Connect to the WebSocket service
- Automatically send a `ping` heartbeat every **15 seconds**
- Handle reconnection automatically with exponential backoff
- Hide all protocol complexity from the developer

### API

```typescript
connect(options: { url: string; apiKey: string; userId: string }): void
disconnect(): void
subscribeToUser(userId: string, callback: (event: PresenceEvent) => void): () => void
getPresence(userId: string): Promise<PresenceStatus>
getPresenceBatch(userIds: string[]): Promise<PresenceStatus[]>
startTyping(userId: string): void
stopTyping(userId: string): void
```

### Rules

- `subscribeToUser` must return an unsubscribe function
- Heartbeat must start automatically after `connect()` and stop after `disconnect()`
- Reconnection must resume subscriptions transparently
- SDK must not expose raw WebSocket or Redis concepts

---

## REACT SDK — packages/sdk-react

### Provider

```tsx
<PresenceProvider client={sdk}>
  {children}
</PresenceProvider>
```

- All hooks consume the SDK instance from context
- One SDK instance is shared across all hooks — no duplicate WS connections

### Hooks

```typescript
usePresence(userId: string): { status: "online" | "offline"; last_seen: string | null }
usePresenceBatch(userIds: string[]): Record<string, { status: "online" | "offline"; last_seen: string | null }>
useTyping(userId: string): { isTyping: boolean }
```

### Rules

- Hooks must auto-subscribe on mount and unsubscribe on unmount
- Hooks must return clean, stable state objects
- No internal WS connections — all hooks use the shared `PresenceProvider` client

---

## TYPING FEATURE

- Typing state is ephemeral — no persistence required
- Stored in Redis as `typing:{tenant_id}:{user_id}` with a TTL of **3 seconds**
- `startTyping` sets (or refreshes) the key with the TTL
- `stopTyping` deletes the key immediately
- If the key expires naturally (user stopped without calling `stopTyping`), Redis keyspace notification triggers a `typing_stop` event broadcast to subscribers
- Typing state must never outlive its TTL

---

## SHARED TYPES — packages/types

Export the following shared interfaces used across all packages:

```typescript
type PresenceStatus = "online" | "offline"

interface UserPresence {
  userId: string
  status: PresenceStatus
  last_seen: string | null
}

interface PresenceEvent {
  type: "user_online" | "user_offline" | "typing_start" | "typing_stop"
  userId: string
  tenantId: string
  timestamp: string
}

interface SessionMeta {
  sessionId: string
  userId: string
  tenantId: string
  expiresAt: string
}
```

---

## NPM PUBLISHING — packages/sdk and packages/sdk-react

Each package must be independently publishable to npm.

### package.json requirements (per package)

```json
{
  "name": "@pretzel/sdk",
  "version": "0.1.0",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "README.md"],
  "publishConfig": {
    "access": "public"
  }
}
```

- `sdk-react` must declare `react` and `react-dom` as `peerDependencies`
- Build tool: **tsup** — configured for ESM + CJS dual output with `.d.ts` declarations
- Each package must include a `README.md` with a minimal usage example
- `packages/types` must also be publishable as `@pretzel/types`

---

## RELIABILITY

- Handle unexpected disconnects gracefully — session must be cleaned up via TTL if disconnect event is missed
- No ghost online users — TTL on session keys guarantees eventual cleanup
- No duplicate sessions — session IDs are server-generated UUIDs, preventing collisions
- Idempotent updates — setting `last_seen` and refreshing TTL must be safe to call multiple times

---

## OUT OF SCOPE — DO NOT IMPLEMENT

- No multi-region support
- No analytics or dashboard UI
- No AI features
- No complex distributed consensus
- No over-abstraction or unnecessary design patterns

---

## GOAL

Build a minimal, reliable, developer-friendly presence system that is easy to use, predictable, and correct.

**Focus on:** correctness · simplicity · developer experience

**Avoid:** premature optimization · unnecessary abstractions · scope creep