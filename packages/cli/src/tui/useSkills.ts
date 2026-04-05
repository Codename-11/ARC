import { useState, useEffect, useCallback } from "react";
import path from "node:path";
import { SkillRegistry, loadSkillsFromDirectory, getArcDir } from "@axiom-labs/arc-core";
import type { Skill } from "@axiom-labs/arc-core";

export interface UseSkillsResult {
  skills: Skill[];
  registry: SkillRegistry;
  loading: boolean;
  reload: () => void;
}

export function useSkills(): UseSkillsResult {
  const [registry, setRegistry] = useState(() => new SkillRegistry());
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const freshRegistry = new SkillRegistry();
      const skillsDir = path.join(getArcDir(), "skills");

      try {
        const loaded = await loadSkillsFromDirectory(skillsDir);
        for (const skill of loaded) {
          freshRegistry.register(skill);
        }
      } catch {
        // Skills directory may not exist yet
      }

      if (!cancelled) {
        setRegistry(freshRegistry);
        setSkills(freshRegistry.list());
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { skills, registry, loading, reload };
}
