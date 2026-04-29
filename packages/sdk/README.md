# @adamthedeveloper/pretzel-sdk

TypeScript SDK for Pretzel presence services.

## Usage

```ts
import { PresenceClient } from "@adamthedeveloper/pretzel-sdk";

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
