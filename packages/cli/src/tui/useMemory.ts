import { useState, useEffect, useCallback } from "react";
import { PersistentMemory } from "@axiom-labs/arc-core";
import type { MemoryEntry, MemoryScope } from "@axiom-labs/arc-core";

export type { MemoryEntry, MemoryScope };

export interface MemoryState {
  entries: MemoryEntry[];
  loading: boolean;
  reload: () => void;
  deleteEntry: (id: string) => boolean;
  search: (query: string) => MemoryEntry[];
}

const SCOPES: MemoryScope[] = ["session", "persistent", "team"];

export function useMemory(): MemoryState {
  const [tick, setTick] = useState(0);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stores] = useState(() => SCOPES.map((s) => new PersistentMemory(s)));

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    try {
      const all: MemoryEntry[] = [];
      for (const store of stores) {
        all.push(...store.list());
      }
      // Sort by most recently accessed first
      all.sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime());

      if (!cancelled) {
        setEntries(all);
        setLoading(false);
      }
    } catch {
      if (!cancelled) {
        setEntries([]);
        setLoading(false);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [tick, stores]);

  const deleteEntry = useCallback(
    (id: string): boolean => {
      for (const store of stores) {
        if (store.delete(id)) {
          reload();
          return true;
        }
      }
      return false;
    },
    [stores, reload],
  );

  const search = useCallback(
    (query: string): MemoryEntry[] => {
      const results: MemoryEntry[] = [];
      for (const store of stores) {
        results.push(...store.search(query));
      }
      return results;
    },
    [stores],
  );

  return { entries, loading, reload, deleteEntry, search };
}
