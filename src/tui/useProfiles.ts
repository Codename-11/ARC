import { useState, useEffect, useCallback } from "react";
import { loadConfig } from "../config.js";
import { getCredentialStatus, type CredentialStatus } from "../auth.js";
import type { ArcConfig, Profile } from "../types.js";

export interface ProfileEntry {
  name: string;
  active: boolean;
  tool: string;
  authType: string;
  description?: string;
  credential?: CredentialStatus;
  credError?: boolean;
}

export interface ProfilesState {
  profiles: ProfileEntry[];
  loading: boolean;
  config: ArcConfig;
  reload: () => void;
}

export function useProfiles(): ProfilesState {
  const [tick, setTick] = useState(0);
  const [config, setConfig] = useState(() => loadConfig());
  const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const freshConfig = loadConfig();
    setConfig(freshConfig);

    async function load() {
      const names = Object.keys(freshConfig.profiles);
      const entries: ProfileEntry[] = [];

      for (const name of names) {
        const profile: Profile = freshConfig.profiles[name];
        let credential: CredentialStatus | undefined;
        let credError = false;

        try {
          credential = await getCredentialStatus(profile);
        } catch {
          credError = true;
        }

        entries.push({
          name,
          active: name === freshConfig.activeProfile,
          tool: profile.tool ?? "claude",
          authType: profile.authType,
          description: profile.description,
          credential,
          credError,
        });
      }

      if (!cancelled) {
        setProfiles(entries);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { profiles, loading, config, reload };
}
