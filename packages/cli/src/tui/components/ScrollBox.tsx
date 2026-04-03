/**
 * ScrollBox — a vertically scrollable container for Ink TUI views.
 *
 * Renders a slice of child elements based on scroll offset.
 * Arrow keys scroll when the parent view passes them through.
 * Shows ▲/▼ indicators when content overflows.
 */
import { type ReactNode } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

interface Props {
  /** Flat array of single-line renderable elements */
  items: ReactNode[];
  /** Number of visible rows (excluding scroll indicators) */
  height: number;
  /** Current scroll offset (managed by parent) */
  offset: number;
}

export function ScrollBox({ items, height, offset }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;

  const totalItems = items.length;
  const canScrollUp = offset > 0;
  const canScrollDown = offset + height < totalItems;
  const needsScroll = totalItems > height;

  // Reserve 1 row for each indicator when scrolling is needed
  const visibleRows = needsScroll ? height - (canScrollUp ? 1 : 0) - (canScrollDown ? 1 : 0) : height;
  const visibleItems = items.slice(offset, offset + visibleRows);

  return (
    <Box flexDirection="column">
      {canScrollUp && (
        <Text color={colors.dimmed}> {"\u25B2"} {offset} more above</Text>
      )}
      {visibleItems}
      {canScrollDown && (
        <Text color={colors.dimmed}> {"\u25BC"} {totalItems - offset - visibleRows} more below</Text>
      )}
    </Box>
  );
}

/** Helper: clamp scroll offset to valid range */
export function clampOffset(offset: number, totalItems: number, visibleHeight: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, totalItems - visibleHeight + 2)));
}
