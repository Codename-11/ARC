import { useEffect, useState, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { useTheme } from "../theme.js";
import { useSkills } from "../useSkills.js";
import type { SkillSource } from "@axiom-labs/arc-core";

interface Props {
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

const BAR_SEGMENTS = 10;

function successBar(rate: number, colors: Record<string, string>): { filled: string; empty: string; color: string } {
  const pct = Math.round(rate * 100);
  const segments = Math.round((pct / 100) * BAR_SEGMENTS);
  const filled = "\u2588".repeat(segments);
  const empty = "\u2591".repeat(BAR_SEGMENTS - segments);

  let color: string;
  if (pct >= 80) {
    color = colors.success;
  } else if (pct >= 50) {
    color = colors.warning;
  } else {
    color = colors.dimmed;
  }

  return { filled, empty, color };
}

function sourceColor(source: SkillSource, colors: Record<string, string>): string {
  switch (source) {
    case "user":
      return colors.text;
    case "mcp":
      return colors.warning;
    case "generated":
      return colors.success;
    case "builtin":
    default:
      return colors.dimmed;
  }
}

export function SkillsView({ focusedPane, inputEnabled }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isActive = focusedPane === "content";
  const { skills, loading, reload } = useSkills();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // --- Fix #3: Safe message timeout ---
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const showMessage = useCallback((text: string) => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage(text);
    messageTimer.current = setTimeout(() => setMessage(null), 2500);
  }, []);
  useEffect(() => () => { if (messageTimer.current) clearTimeout(messageTimer.current); }, []);

  // Clamp selectedIndex when skills change
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, skills.length - 1)));
  }, [skills.length]);

  useInput(
    (input, key) => {
      if (!isActive || !inputEnabled) return;

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(skills.length - 1, i + 1));
        return;
      }

      if (input === "l") {
        reload();
        showMessage("Reloading skills...");
        return;
      }
    },
    { isActive: isActive && inputEnabled },
  );

  const totalCount = skills.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box paddingLeft={2} gap={2} marginBottom={1}>
        <Text color={colors.text} bold>
          SKILLS
        </Text>
        <Text color={colors.dimmed}>
          {totalCount} LOADED
        </Text>
      </Box>

      {loading ? (
        <Box paddingLeft={2}>
          <Spinner label="Loading skills..." />
        </Box>
      ) : (
        <>
          {/* Column headers */}
          <Box paddingLeft={2}>
            <Box width={18}>
              <Text color={colors.dimmed}>NAME</Text>
            </Box>
            <Box width={12}>
              <Text color={colors.dimmed}>SOURCE</Text>
            </Box>
            <Box width={8}>
              <Text color={colors.dimmed}>TOOLS</Text>
            </Box>
            <Box width={18}>
              <Text color={colors.dimmed}>SUCCESS</Text>
            </Box>
          </Box>

          {/* Separator */}
          <Box paddingLeft={2}>
            <Box width={18}>
              <Text color={colors.border}>{"\u2500".repeat(16)}</Text>
            </Box>
            <Box width={12}>
              <Text color={colors.border}>{"\u2500".repeat(10)}</Text>
            </Box>
            <Box width={8}>
              <Text color={colors.border}>{"\u2500".repeat(6)}</Text>
            </Box>
            <Box width={18}>
              <Text color={colors.border}>{"\u2500".repeat(16)}</Text>
            </Box>
          </Box>

          {/* Skill rows */}
          {skills.length === 0 ? (
            <Box paddingLeft={2} marginTop={1}>
              <Text color={colors.dimmed}>No skills loaded. Add .json files to ~/.arc/skills/</Text>
            </Box>
          ) : (
            skills.map((skill, index) => {
              const isSelected = index === selectedIndex;
              const bar = successBar(skill.successRate, colors);
              const pct = Math.round(skill.successRate * 100);
              const sColor = sourceColor(skill.source, colors);

              return (
                <Box
                  key={skill.name}
                  paddingLeft={2}
                  backgroundColor={isSelected ? colors.bgSelected : undefined}
                >
                  <Box width={18}>
                    <Text
                      color={isSelected ? colors.primary : colors.text}
                      bold={isSelected}
                      wrap="truncate"
                    >
                      {skill.name}
                    </Text>
                  </Box>
                  <Box width={12}>
                    <Text color={sColor}>
                      {skill.source.toUpperCase()}
                    </Text>
                  </Box>
                  <Box width={8}>
                    <Text color={colors.text}>
                      {skill.tools.length}
                    </Text>
                  </Box>
                  <Box width={18} gap={0}>
                    <Text color={bar.color}>{bar.filled}</Text>
                    <Text color={colors.dimmed}>{bar.empty}</Text>
                    <Text color={colors.dimmed}> {String(pct).padStart(3)}%</Text>
                  </Box>
                </Box>
              );
            })
          )}
        </>
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
          <Text color={colors.primary} bold>[l]</Text> reload{"  "}
          <Text color={colors.primary} bold>[i]</Text> info{"  "}
          <Text color={colors.primary} bold>[esc]</Text> back
        </Text>
      </Box>
    </Box>
  );
}
