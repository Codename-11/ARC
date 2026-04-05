import { useState, useEffect, useRef, useCallback } from "react";
import { RemoteAgentRegistry, checkHealth } from "@axiom-labs/arc-core";
import type { RemoteAgent } from "@axiom-labs/arc-core";

export interface UseAgentsResult {
  agents: RemoteAgent[];
  loading: boolean;
  reload: () => void;
  checkAgentHealth: (agentId: string) => Promise<void>;
  checkAllHealth: () => Promise<void>;
}

export function useAgents(): UseAgentsResult {
  const registryRef = useRef(new RemoteAgentRegistry());
  const mountedRef = useRef(true);
  const [agents, setAgents] = useState<RemoteAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    setAgents(registryRef.current.list());
    setLoading(false);
  }, [tick]);

  const checkAgentHealth = useCallback(async (agentId: string) => {
    const agent = registryRef.current.get(agentId);
    if (!agent) return;

    const status = await checkHealth(agent);
    if (!mountedRef.current) return;

    registryRef.current.updateStatus(agentId, status);
    setAgents(registryRef.current.list());
  }, []);

  const checkAllHealth = useCallback(async () => {
    const currentAgents = registryRef.current.list();

    await Promise.allSettled(
      currentAgents.map(async (agent) => {
        const status = await checkHealth(agent);
        if (!mountedRef.current) return;
        registryRef.current.updateStatus(agent.id, status);
      }),
    );

    if (!mountedRef.current) return;
    setAgents(registryRef.current.list());
  }, []);

  return { agents, loading, reload, checkAgentHealth, checkAllHealth };
}
