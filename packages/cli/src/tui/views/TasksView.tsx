import { useEffect, useState, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme, type ThemeColors } from "../theme.js";
import { useTasks } from "../useTasks.js";
import type { TaskStatus, TaskPriority } from "@axiom-labs/arc-core";

interface Props {
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

function statusIndicator(
  status: TaskStatus,
  colors: ThemeColors,
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
  colors: ThemeColors,
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
  const { tasks, cancelTask, cycleStatus } = useTasks();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // --- Fix #3: Safe message timeout ---
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showMessage = useCallback((text: string) => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text);
    messageTimer.current = setTimeout(() => setMessage(null), 2500);
  }, []);
  useEffect(() => () => { if (messageTimer.current) clearTimeout(messageTimer.current); }, []);

  // --- Fix #4: Clamp selectedIndex when tasks change ---
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, tasks.length - 1)));
  }, [tasks.length]);

  useInput(
    (input, key) => {
      if (!isActive || !inputEnabled) return;

      // Cancel confirmation
      if (confirmCancel) {
        if (input === "y" || input === "Y") {
          const task = tasks[selectedIndex];
          if (task) {
            cancelTask(task.id);
            showMessage("Task cancelled");
          }
        }
        setConfirmCancel(false);
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(tasks.length - 1, i + 1));
        return;
      }

      // --- Fix #9: Rename to cancel ---
      if (input === "d") {
        if (tasks[selectedIndex]) {
          setConfirmCancel(true);
          setMessage("Cancel this task? (y/n)");
        }
        return;
      }

      if (input === "s") {
        const task = tasks[selectedIndex];
        if (task) {
          cycleStatus(task.id);
          showMessage("Status cycled");
        }
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
          <Text color={colors.border}>{"\u2500".repeat(8)}</Text>
        </Box>
        <Box width={32}>
          <Text color={colors.border}>{"\u2500".repeat(30)}</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.border}>{"\u2500".repeat(12)}</Text>
        </Box>
        <Box width={11}>
          <Text color={colors.border}>{"\u2500".repeat(9)}</Text>
        </Box>
        <Box width={10}>
          <Text color={colors.border}>{"\u2500".repeat(8)}</Text>
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
                  color={colors.text}
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

      {/* Message bar */}
      {message && (
        <Box paddingLeft={2} paddingTop={1}>
          <Text color={colors.warning}>{message}</Text>
        </Box>
      )}

      {/* Key hints */}
      <Box paddingLeft={2} paddingTop={1} gap={2}>
        <Text color={colors.dimmed}>
          <Text color={colors.primary} bold>[s]</Text> cycle status{"  "}
          <Text color={colors.primary} bold>[d]</Text> cancel{"  "}
          <Text color={colors.primary} bold>[esc]</Text> back
        </Text>
      </Box>
    </Box>
  );
}
