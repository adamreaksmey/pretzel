# @pretzel/sdk-react

React hooks wrapper for the Pretzel SDK.

## Usage

```tsx
import { PresenceProvider, usePresence } from "@pretzel/sdk-react";

function PresenceBadge({ userId }: { userId: string }) {
  const presence = usePresence(userId);
  return <span>{presence.status}</span>;
}

// <PresenceProvider client={client}>...</PresenceProvider>
```
