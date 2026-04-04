import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ProfileEntry } from "../useProfiles.js";

// TODO: Wire to TaskStore from @axiom-labs/arc-core
interface Task {
  id: string;
  name: string;
  status: "completed" | "working" | "failed" | "pending";
  priority: "high" | "medium" | "low";
  assignee: string;
}

// TODO: Replace with live data from TaskStore
const PLACEHOLDER_TASKS: Task[] = [
  { id: "t-001", name: "migrate auth to oauth2", status: "completed", priority: "high", assignee: "claude-main" },
  { id: "t-002", name: "refactor hook pipeline", status: "working", priority: "medium", assignee: "gemini-dev" },
  { id: "t-003", name: "fix swap credential leak", status: "failed", priority: "high", assignee: "claude-main" },
  { id: "t-004", name: "add MCP server discovery", status: "pending", priority: "low", assignee: "unassigned" },
];

interface Props {
  profiles: ProfileEntry[];
}

function SectionHeader({ label, fillWidth }: { label: string; fillWidth?: number }) {
  const { theme } = useTheme();
  const fill = fillWidth ?? Math.max(2, 24 - label.length);
  return (
    <Box gap={1} marginBottom={1}>
      <Text color={theme.colors.dimmed}>{label}</Text>
      <Text color={theme.colors.border}>{"─".repeat(fill)}</Text>
    </Box>
  );
}

function StatusRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const { theme } = useTheme();
  return (
    <Box gap={1}>
      <Box width={18}>
        <Text color={theme.colors.dimmed}>{label}</Text>
      </Box>
      <Text color={color ?? theme.colors.text}>{value}</Text>
    </Box>
  );
}

function StatusBadge({ status }: { status: Task["status"] }) {
  const { theme } = useTheme();
  const { colors } = theme;
  const colorMap: Record<Task["status"], string> = {
    completed: colors.success,
    working: colors.warning,
    failed: colors.error,
    pending: colors.dimmed,
  };
  const labelMap: Record<Task["status"], string> = {
    completed: "done",
    working: "work",
    failed: "fail",
    pending: "wait",
  };
  return <Text color={colorMap[status]}>{`[${labelMap[status]}]`}</Text>;
}

function PriorityLabel({ priority }: { priority: Task["priority"] }) {
  const { theme } = useTheme();
  const { colors } = theme;
  const colorMap: Record<Task["priority"], string> = {
    high: colors.error,
    medium: colors.warning,
    low: colors.dimmed,
  };
  return <Text color={colorMap[priority]}>{priority}</Text>;
}

export function TasksView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  // TODO: Wire to TaskStore
  const tasks = PLACEHOLDER_TASKS;

  const total = tasks.length;
  const working = tasks.filter((t) => t.status === "working").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <SectionHeader label="tasks" />

      {tasks.length === 0 ? (
        <Text color={colors.dimmed}>No tasks.</Text>
      ) : (
        <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
          {/* Column headers */}
          <Box gap={1} marginBottom={1}>
            <Box width={26}><Text color={colors.dimmed} bold>name</Text></Box>
            <Box width={8}><Text color={colors.dimmed} bold>status</Text></Box>
            <Box width={10}><Text color={colors.dimmed} bold>priority</Text></Box>
            <Text color={colors.dimmed} bold>assignee</Text>
          </Box>

          {tasks.map((task) => (
            <Box key={task.id} gap={1}>
              <Box width={26}>
                <Text color={colors.text}>
                  {task.name.length > 24 ? task.name.slice(0, 23) + "…" : task.name}
                </Text>
              </Box>
              <Box width={8}><StatusBadge status={task.status} /></Box>
              <Box width={10}><PriorityLabel priority={task.priority} /></Box>
              <Text color={colors.dimmed}>{task.assignee}</Text>
            </Box>
          ))}
        </Box>
      )}

      <SectionHeader label="summary" />
      <Box flexDirection="column" paddingLeft={1}>
        <StatusRow label="total" value={String(total)} />
        <StatusRow label="working" value={String(working)} color={colors.warning} />
        <StatusRow label="completed" value={String(completed)} color={colors.success} />
        <StatusRow label="failed" value={String(failed)} color={colors.error} />
      </Box>
    </Box>
  );
}
