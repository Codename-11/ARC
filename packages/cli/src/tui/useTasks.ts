import { useState, useEffect, useRef, useCallback } from "react";
import { TaskStore } from "@axiom-labs/arc-core";
import type { Task, TaskStatus } from "@axiom-labs/arc-core";

const STATUS_CYCLE: TaskStatus[] = [
  "created",
  "assigned",
  "working",
  "input-required",
  "completed",
  "failed",
  "cancelled",
];

export interface UseTasksResult {
  tasks: Task[];
  loading: boolean;
  reload: () => void;
  cycleStatus: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
}

export function useTasks(): UseTasksResult {
  const storeRef = useRef(new TaskStore());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    setTasks(storeRef.current.list());
    setLoading(false);
  }, [tick]);

  // Refresh on interval
  useEffect(() => {
    const timer = setInterval(() => {
      setTasks(storeRef.current.list());
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const cycleStatus = useCallback((taskId: string) => {
    const task = storeRef.current.get(taskId);
    if (!task) return;
    const idx = STATUS_CYCLE.indexOf(task.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    storeRef.current.update(taskId, { status: next });
    setTasks(storeRef.current.list());
  }, []);

  const cancelTask = useCallback((taskId: string) => {
    storeRef.current.stop(taskId);
    setTasks(storeRef.current.list());
  }, []);

  return { tasks, loading, reload, cycleStatus, cancelTask };
}
