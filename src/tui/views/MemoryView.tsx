import { useEffect, useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme.js";
import { PersistentMemory } from "../../../packages/core/src/memory/index.js";
import { decayScore } from "../../../packages/core/src/memory/aging.js";
import type { MemoryEntry, MemoryScope } from "../../../packages/core/src/memory/index.js";

interface Props {
  focusedPane: "sidebar" | "content";
  inputEnabled: boolean;
}

const SCOPES: Array<MemoryScope | "all"> = ["all", "persistent", "session", "team"];
const BAR_SEGMENTS = 6;

function relevanceBar(score: number, colors: Record<string, string>): { filled: string; empty: string; color: string } {
  const pct = Math.round(score * 100);
  const segments = Math.round((pct / 100) * BAR_SEGMENTS);
  const filled = "\u2588".repeat(segments);
  const empty = "\u2591".repeat(BAR_SEGMENTS - segments);

  let color: string;
  if (pct >= 70) {
    color = colors.success;
  } else if (pct >= 40) {
    color = colors.warning;
  } else {
    color = colors.dimmed;
  }

  return { filled, empty, color };
}

export function MemoryView({ focusedPane, inputEnabled }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isActive = focusedPane === "content";
  const storesRef = useRef<Map<MemoryScope, PersistentMemory>>(new Map());
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scopeIndex, setScopeIndex] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Initialize memory stores for all scopes
  useEffect(() => {
    const scopes: MemoryScope[] = ["persistent", "session", "team"];
    const map = new Map<MemoryScope, PersistentMemory>();
    for (const scope of scopes) {
      map.set(scope, new PersistentMemory(scope));
    }
    storesRef.current = map;
    loadEntries("all", "");
  }, []);

  function loadEntries(scope: MemoryScope | "all", query: string) {
    const stores = storesRef.current;
    let result: MemoryEntry[] = [];

    if (scope === "all") {
      for (const store of stores.values()) {
        if (query) {
          result = result.concat(store.search(query));
        } else {
          result = result.concat(store.list());
        }
      }
    } else {
      const store = stores.get(scope);
      if (store) {
        result = query ? store.search(query) : store.list();
      }
    }

    // Sort by decayed relevance score descending
    const now = new Date();
    result.sort((a, b) => decayScore(b, now) - decayScore(a, now));

    setEntries(result);
    setSelectedIndex(0);
  }

  useEffect(() => {
    const currentScope = SCOPES[scopeIndex] ?? "all";
    loadEntries(currentScope, searchQuery);
  }, [scopeIndex, searchQuery]);

  useInput(
    (input, key) => {
      if (!isActive || !inputEnabled) return;

      // Search mode input handling
      if (searchMode) {
        if (key.escape) {
          setSearchMode(false);
          setSearchQuery("");
          return;
        }
        if (key.return) {
          setSearchMode(false);
          return;
        }
        if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && input.length === 1) {
          setSearchQuery((q) => q + input);
        }
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(entries.length - 1, i + 1));
        return;
      }

      if (key.tab) {
        setScopeIndex((i) => (i + 1) % SCOPES.length);
        return;
      }

      if (input === "s") {
        setSearchMode(true);
        setSearchQuery("");
        return;
      }
    },
    { isActive: isActive && inputEnabled },
  );

  const currentScope = SCOPES[scopeIndex] ?? "all";
  const scopeLabel = currentScope === "all" ? "ALL" : currentScope.toUpperCase();
  const totalCount = entries.length;
  const now = new Date();

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box paddingLeft={2} gap={2} marginBottom={1}>
        <Text color={colors.text} bold>
          MEMORY
        </Text>
        <Text color={colors.dimmed}>
          {totalCount} ENTRIES {"\u00B7"} {scopeLabel}
        </Text>
      </Box>

      {/* Search bar (when active) */}
      {searchMode && (
        <Box paddingLeft={2} marginBottom={1} gap={1}>
          <Text color={colors.primary}>SEARCH:</Text>
          <Text color={colors.text}>{searchQuery}</Text>
          <Text color={colors.primary}>{"\u258C"}</Text>
        </Box>
      )}

      {/* Column headers */}
      <Box paddingLeft={2}>
        <Box width={13}>
          <Text color={colors.dimmed}>TYPE</Text>
        </Box>
        <Box width={38}>
          <Text color={colors.dimmed}>CONTENT</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.dimmed}>RELEVANCE</Text>
        </Box>
        <Box width={8}>
          <Text color={colors.dimmed}>ACCESS</Text>
        </Box>
      </Box>

      {/* Separator */}
      <Box paddingLeft={2}>
        <Box width={13}>
          <Text color={colors.border}>{"\u2500".repeat(11)}</Text>
        </Box>
        <Box width={38}>
          <Text color={colors.border}>{"\u2500".repeat(36)}</Text>
        </Box>
        <Box width={14}>
          <Text color={colors.border}>{"\u2500".repeat(12)}</Text>
        </Box>
        <Box width={8}>
          <Text color={colors.border}>{"\u2500".repeat(6)}</Text>
        </Box>
      </Box>

      {/* Entries */}
      {entries.length === 0 ? (
        <Box paddingLeft={2} marginTop={1}>
          <Text color={colors.dimmed}>
            {searchQuery ? "No matches found." : "No memory entries."}
          </Text>
        </Box>
      ) : (
        entries.slice(0, 20).map((entry, index) => {
          const isSelected = index === selectedIndex;
          const score = decayScore(entry, now);
          const pct = Math.round(score * 100);
          const bar = relevanceBar(score, colors);

          return (
            <Box
              key={entry.id}
              paddingLeft={2}
              backgroundColor={isSelected ? colors.bgSelected : undefined}
            >
              <Box width={13}>
                <Text color={isSelected ? colors.primary : colors.text} bold>
                  {entry.type.toUpperCase()}
                </Text>
              </Box>
              <Box width={38}>
                <Text
                  color={isSelected ? colors.text : colors.text}
                  bold={isSelected}
                  wrap="truncate"
                >
                  {entry.content}
                </Text>
              </Box>
              <Box width={14} gap={0}>
                <Text color={bar.color}>{bar.filled}</Text>
                <Text color={colors.dimmed}>{bar.empty}</Text>
                <Text color={colors.dimmed}> {String(pct).padStart(3)}%</Text>
              </Box>
              <Box width={8}>
                <Text color={colors.dimmed}>
                  {"  "}{entry.accessCount}
                </Text>
              </Box>
            </Box>
          );
        })
      )}

      {/* Key hints */}
      <Box paddingLeft={2} paddingTop={1} gap={2}>
        <Text color={colors.dimmed}>
          <Text color={colors.primary} bold>[s]</Text> search{"  "}
          <Text color={colors.primary} bold>[p]</Text> prune{"  "}
          <Text color={colors.primary} bold>[tab]</Text> scope{"  "}
          <Text color={colors.primary} bold>[esc]</Text> back
        </Text>
      </Box>
    </Box>
  );
}
