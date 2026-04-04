import { useEffect, useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import { TaskStore } from "../../../packages/core/src/tasks/index.js";
import type { Task, TaskStatus, TaskPriority } from "../../../packages/core/src/tasks/index.js";

interface Props {
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

function statusIndicator(
  status: TaskStatus,
  colors: Record<string, string>,
): { icon: string; label: string; color: string } {
  switch (status) {
    case "working":
      return { icon: "\u25CF", label: "WORKING", color: colors.success };
    case "completed":
      return { icon: "\u2713", label: "COMPLETED", color: colors.dimmed };
    case "failed":
      return { icon: "\u2717", label: "FAILED", color: colors.error };
    case "cancelled":
      return { icon: "\u2717", label: "CANCELLED", color: colors.dimmed };
    case "assigned":
      return { icon: "\u25CB", label: "ASSIGNED", color: colors.primary };
    case "input-required":
      return { icon: "?", label: "INPUT REQ", color: colors.warning };
    case "created":
    default:
      return { icon: "\u25CB", label: "CREATED", color: colors.dimmed };
  }
}

function priorityColor(
  priority: TaskPriority,
  colors: Record<string, string>,
): string {
  switch (priority) {
    case "critical":
      return colors.error;
    case "high":
      return colors.warning;
    case "medium":
      return colors.text;
    case "low":
    default:
      return colors.dimmed;
  }
}

export function TasksView({ focusedPane, inputEnabled }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isActive = focusedPane === "content";
  const storeRef = useRef<TaskStore | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    storeRef.current = new TaskStore();
    setTasks(storeRef.current.list());
  }, []);

  // Refresh on interval
  useEffect(() => {
    const timer = setInterval(() => {
      if (storeRef.current) {
        setTasks(storeRef.current.list());
      }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(0, tasks.length - 1)),
    );
  }, [tasks.length]);

  useInput(
    (_input, key) => {
      if (!isActive || !inputEnabled) return;

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(tasks.length - 1, i + 1));
        return;
      }
    },
    { isActive: isActive && inputEnabled },
  );

  const workingCount = tasks.filter((t) => t.status === "working").length;
  const totalCount = tasks.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box paddingLeft={2} gap={2} marginBottom={1}>
        <Text color={colors.text} bold>
          TASKS
        </Text>
        <Text color={colors.dimmed}>
          {workingCount} WORKING {"\u00B7"} {totalCount} TOTAL
        </Text>
      </Box>

      {/* Column headers */}
      <Box paddingLeft={2}>
        <Box width={10}>
          <Text color={colors.dimmed}>ID</Text>
        </Box>
        <Box width={32}>
          <Text color={colors.dimmed}>DESCRIPTION</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.dimmed}>STATUS</Text>
        </Box>
        <Box width={11}>
          <Text color={colors.dimmed}>PRIORITY</Text>
        </Box>
        <Box width={10}>
          <Text color={colors.dimmed}>ASSIGNEE</Text>
        </Box>
      </Box>

      {/* Separator */}
      <Box paddingLeft={2}>
        <Box width={10}>
          <Text color={colors.border}>
            {"\u2500".repeat(8)}
          </Text>
        </Box>
        <Box width={32}>
          <Text color={colors.border}>
            {"\u2500".repeat(30)}
          </Text>
        </Box>
        <Box width={14}>
          <Text color={colors.border}>
            {"\u2500".repeat(12)}
          </Text>
        </Box>
        <Box width={11}>
          <Text color={colors.border}>
            {"\u2500".repeat(9)}
          </Text>
        </Box>
        <Box width={10}>
          <Text color={colors.border}>
            {"\u2500".repeat(8)}
          </Text>
        </Box>
      </Box>

      {/* Task rows */}
      {tasks.length === 0 ? (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={colors.dimmed}>No tasks found.</Text>
        </Box>
      ) : (
        tasks.map((task, index) => {
          const isSelected = index === selectedIndex;
          const status = statusIndicator(task.status, colors);
          const pColor = priorityColor(task.priority, colors);

          return (
            <Box
              key={task.id}
              paddingLeft={2}
              backgroundColor={isSelected ? colors.bgSelected : undefined}
            >
              <Box width={10}>
                <Text
                  color={isSelected ? colors.primary : colors.dimmed}
                  wrap="truncate"
                >
                  {task.id.slice(0, 8)}
                </Text>
              </Box>
              <Box width={32}>
                <Text
                  color={isSelected ? colors.text : colors.text}
                  bold={isSelected}
                  wrap="truncate"
                >
                  {task.description}
                </Text>
              </Box>
              <Box width={14} gap={1}>
                <Text color={status.color}>{status.icon}</Text>
                <Text color={status.color}>{status.label}</Text>
              </Box>
              <Box width={11}>
                <Text color={pColor}>
                  {task.priority.toUpperCase()}
                </Text>
              </Box>
              <Box width={10}>
                <Text color={colors.dimmed}>
                  {task.assignee ?? "\u2014"}
                </Text>
              </Box>
            </Box>
          );
        })
      )}

      {/* Key hints */}
      <Box paddingLeft={2} paddingTop={1} gap={2}>
        <Text color={colors.dimmed}>
          <Text color={colors.primary} bold>
            [c]
          </Text>{" "}
          create{"  "}
          <Text color={colors.primary} bold>
            [u]
          </Text>{" "}
          update{"  "}
          <Text color={colors.primary} bold>
            [s]
          </Text>{" "}
          stop{"  "}
          <Text color={colors.primary} bold>
            [enter]
          </Text>{" "}
          details{"  "}
          <Text color={colors.primary} bold>
            [esc]
          </Text>{" "}
          back
        </Text>
      </Box>
    </Box>
  );
}
