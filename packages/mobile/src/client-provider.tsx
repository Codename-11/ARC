import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ArcClient } from "./arc-client-rn";

export interface Settings {
  host: string;
  token: string;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "unconfigured";

interface ClientContextValue {
  client: ArcClient | null;
  status: ConnectionStatus;
  error: string | null;
  settings: Settings | null;
  saveSettings: (settings: Settings) => Promise<void>;
  clearSettings: () => Promise<void>;
  reconnect: () => Promise<void>;
}

const STORAGE_KEY = "arc.settings.v1";

const ClientContext = createContext<ClientContextValue | null>(null);

function toWsUrl(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
    return trimmed;
  }
  return `ws://${trimmed}`;
}

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<ArcClient | null>(null);

  const connectWith = useCallback(
    async (next: Settings | null, current: ArcClient | null) => {
      if (current) {
        try {
          await current.close();
        } catch {
          /* ignore */
        }
      }
      if (!next || !next.host || !next.token) {
        setClient(null);
        setStatus("unconfigured");
        setError(null);
        return;
      }
      const nextClient = new ArcClient({
        url: toWsUrl(next.host),
        token: next.token,
      });
      setClient(nextClient);
      setStatus("connecting");
      setError(null);
      try {
        await nextClient.connect();
        setStatus("connected");
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (!raw) {
          setStatus("unconfigured");
          return;
        }
        const parsed = JSON.parse(raw) as Settings;
        setSettings(parsed);
        await connectWith(parsed, null);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectWith]);

  const saveSettings = useCallback(
    async (next: Settings) => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSettings(next);
      await connectWith(next, client);
    },
    [connectWith, client],
  );

  const clearSettings = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setSettings(null);
    await connectWith(null, client);
  }, [connectWith, client]);

  const reconnect = useCallback(async () => {
    if (!settings) return;
    await connectWith(settings, client);
  }, [connectWith, settings, client]);

  const value = useMemo<ClientContextValue>(
    () => ({
      client,
      status,
      error,
      settings,
      saveSettings,
      clearSettings,
      reconnect,
    }),
    [client, status, error, settings, saveSettings, clearSettings, reconnect],
  );

  return (
    <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
  );
}

export function useArcClient(): ClientContextValue {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    throw new Error("useArcClient must be used inside <ClientProvider>");
  }
  return ctx;
}
