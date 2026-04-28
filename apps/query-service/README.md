# Query Service

Read-optimized REST API for tenant-scoped presence queries.

## Responsibilities

- Return current presence (`online` or `offline`) for a user
- Return `last_seen` timestamp for offline users when available
- Support batch lookups for multiple users
- Enforce tenant scoping on every request
- Stay stateless and read from Redis only

## API

- Base URL: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/docs`

### `GET /presence/:userId`

Headers:
- `x-tenant-id` (optional when `x-api-key` is present)
- `x-api-key` in format `tenant:<tenantId>` (optional when `x-tenant-id` is present)

Response:

```json
{
  "userId": "user-123",
  "status": "online",
  "last_seen": null
}
```

### `POST /presence/batch`

Headers:
- `x-tenant-id` (optional when `x-api-key` is present)
- `x-api-key` in format `tenant:<tenantId>` (optional when `x-tenant-id` is present)

Body:

```json
{
  "userIds": ["user-123", "user-456"]
}
```

Response:

```json
[
  {
    "userId": "user-123",
    "status": "online",
    "last_seen": null
  },
  {
    "userId": "user-456",
    "status": "offline",
    "last_seen": "2026-01-01T00:00:00.000Z"
  }
]
```

## Run

```bash
cp .env.example .env
npm run start:dev -w query-service
```

## Environment

- `REDIS_URL` Redis connection string
- `PORT` query-service HTTP port

## Test

```bash
npm test -w query-service
npm test -w query-service -- --runInBand app.service.spec.ts
```
