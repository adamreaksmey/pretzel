import { createContext, useContext, type ReactNode } from "react";
import type { PresenceClient } from "@pretzel/sdk";

const missingProviderErrorMessage =
  "PresenceProvider is required to use this hook";

const PresenceClientContext = createContext<PresenceClient | null>(null);

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
