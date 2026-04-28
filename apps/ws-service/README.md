# WS Service

Realtime ingestion and broadcast service for Pretzel presence.

## Responsibilities

- Accept WebSocket connections with tenant-scoped auth
- Generate server-side `session_id` (UUID) per connection
- Track active sessions in Redis
- Refresh session TTL on heartbeat
- Emit state transition events only on real transitions (`0 -> 1`, `1 -> 0`)
- Handle TTL-expiry cleanup and typing expiry events via Redis keyspace notifications

## Runtime

- Base URL: `http://localhost:3001`
- Swagger UI (minimal HTTP surface): `http://localhost:3001/docs`
- Main transport: WebSocket (`socket.io`)

## WebSocket Protocol

### Connection auth payload

```json
{
  "apiKey": "tenant:acme",
  "userId": "user-123"
}
```

### Client -> Server events

- `ping` (every 15s)
- `startTyping`
- `stopTyping`

### Server -> Client events

- `session_assigned`
- `user_online`
- `user_offline`
- `typing_start`
- `typing_stop`

## Redis Semantics

- Session TTL: 30 seconds
- Typing TTL: 3 seconds
- Required keyspace notification flags: `Ex`

## Run

```bash
cp .env.example .env
npm run start:dev -w @pretzel/ws-service
```

## Environment

- `REDIS_URL` Redis connection string
- `WS_SERVICE_PORT` ws-service HTTP/Socket.IO port

## Test

```bash
npm test -w @pretzel/ws-service
npm test -w @pretzel/ws-service -- --runInBand presence.service.spec.ts
```
