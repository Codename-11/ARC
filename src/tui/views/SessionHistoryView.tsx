import { useEffect, useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import { SessionStore } from "../../../packages/core/src/sessions.js";
import type { SessionThread, SessionStatus } from "../../../packages/core/src/sessions.js";

interface Props {
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

function statusIndicator(
  status: SessionStatus,
  colors: Record<string, string>,
): { icon: string; label: string; color: string } {
  switch (status) {
    case "active":
      return { icon: "\u25CF", label: "ACTIVE", color: colors.success };
    case "suspended":
      return { icon: "\u25D0", label: "SUSPENDED", color: colors.warning };
    case "completed":
      return { icon: "\u2713", label: "COMPLETED", color: colors.dimmed };
    default:
      return { icon: "\u25CB", label: status.toUpperCase(), color: colors.dimmed };
  }
}

function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo ago`;
}

export function SessionHistoryView({ focusedPane, inputEnabled }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isActive = focusedPane === "content";
  const storeRef = useRef<SessionStore | null>(null);
  const [sessions, setSessions] = useState<SessionThread[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    storeRef.current = new SessionStore();
    setSessions(storeRef.current.list());
  }, []);

  // Refresh on interval
  useEffect(() => {
    const timer = setInterval(() => {
      if (storeRef.current) {
        setSessions(storeRef.current.list());
      }
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSelectedIndex((current) =>
      Math.min(current, Math.max(0, sessions.length - 1)),
    );
  }, [sessions.length]);

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 2000);
  }

  useInput(
    (input, key) => {
      if (!isActive || !inputEnabled) return;

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
        return;
      }

      // Resume suspended session
      if (input === "r") {
        const selected = sessions[selectedIndex];
        if (!selected) return;
        if (selected.status !== "suspended") {
          showMessage("Only suspended sessions can be resumed.");
          return;
        }
        try {
          storeRef.current?.resume(selected.id);
          setSessions(storeRef.current?.list() ?? []);
          showMessage(`Resumed: ${selected.name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showMessage(`Resume failed: ${msg}`);
        }
        return;
      }

      // Complete session
      if (input === "c") {
        const selected = sessions[selectedIndex];
        if (!selected) return;
        if (selected.status === "completed") {
          showMessage("Session is already completed.");
          return;
        }
        try {
          storeRef.current?.complete(selected.id);
          setSessions(storeRef.current?.list() ?? []);
          showMessage(`Completed: ${selected.name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showMessage(`Complete failed: ${msg}`);
        }
        return;
      }
    },
    { isActive: isActive && inputEnabled },
  );

  // Sort sessions: active first, then suspended, then completed; within groups by lastActive desc
  const sortedSessions = [...sessions].sort((a, b) => {
    const statusOrder: Record<SessionStatus, number> = {
      active: 0,
      suspended: 1,
      completed: 2,
    };
    const oa = statusOrder[a.status] ?? 3;
    const ob = statusOrder[b.status] ?? 3;
    if (oa !== ob) return oa - ob;
    return b.lastActive.localeCompare(a.lastActive);
  });

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const totalCount = sessions.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box paddingLeft={2} gap={2} marginBottom={1}>
        <Text color={colors.text} bold>
          SESSIONS
        </Text>
        <Text color={colors.dimmed}>
          {activeCount} ACTIVE {"\u00B7"} {totalCount} TOTAL
        </Text>
      </Box>

      {/* Column headers */}
      <Box paddingLeft={2}>
        <Box width={24}>
          <Text color={colors.dimmed}>NAME</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.dimmed}>PROFILE</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.dimmed}>STATUS</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.dimmed}>LAST ACTIVE</Text>
        </Box>
      </Box>

      {/* Separator */}
      <Box paddingLeft={2}>
        <Box width={24}>
          <Text color={colors.border}>{"\u2500".repeat(22)}</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.border}>{"\u2500".repeat(12)}</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.border}>{"\u2500".repeat(12)}</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.border}>{"\u2500".repeat(12)}</Text>
        </Box>
      </Box>

      {/* Session rows */}
      {sortedSessions.length === 0 ? (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={colors.dimmed}>No sessions found.</Text>
        </Box>
      ) : (
        sortedSessions.map((session, index) => {
          const isSelected = index === selectedIndex;
          const status = statusIndicator(session.status, colors);
          const ago = timeAgo(session.lastActive);

          return (
            <Box
              key={session.id}
              paddingLeft={2}
              backgroundColor={isSelected ? colors.bgSelected : undefined}
            >
              <Box width={24}>
                <Text
                  color={isSelected ? colors.primary : colors.text}
                  bold={isSelected}
                  wrap="truncate"
                >
                  {session.name}
                </Text>
              </Box>
              <Box width={14}>
                <Text color={colors.dimmed} wrap="truncate">
                  {session.profile}
                </Text>
              </Box>
              <Box width={14} gap={1}>
                <Text color={status.color}>{status.icon}</Text>
                <Text color={status.color}>{status.label}</Text>
              </Box>
              <Box width={14}>
                <Text color={colors.dimmed}>{ago}</Text>
              </Box>
            </Box>
          );
        })
      )}

      {/* Status message */}
      {message && (
        <Box paddingLeft={2} paddingTop={1}>
          <Text color={colors.warning}>{message}</Text>
        </Box>
      )}

      {/* Key hints */}
      <Box paddingLeft={2} paddingTop={1} gap={2}>
        <Text color={colors.dimmed}>
          <Text color={colors.primary} bold>[r]</Text> resume{"  "}
          <Text color={colors.primary} bold>[c]</Text> complete{"  "}
          <Text color={colors.primary} bold>[esc]</Text> back
        </Text>
      </Box>
    </Box>
  );
}
