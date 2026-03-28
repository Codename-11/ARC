import { Box, Text } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { useTheme } from "../theme.js";

// ARC branded logo with [>] mark and // slashes — ~57 chars wide.
// Segments: bracket-left (primary), arrow/> (contrast), bracket-right (primary), ARC (primary), slashes (contrast).
export const ARC_LOGO = [
  { bL: "███╗", gt: "██╗", bR: " ███╗", mid: "     █████╗ ██████╗  ██████╗        ", sl: "██╗ ██╗" },
  { bL: "██╔╝", gt: "╚██╗", bR: "╚██║", mid: "    ██╔══██╗██╔══██╗██╔════╝       ", sl: "██╔╝██╔╝" },
  { bL: "██║", gt: "  ╚██╗", bR: "██║", mid: "    ███████║██████╔╝██║           ", sl: "██╔╝██╔╝" },
  { bL: "██║", gt: "  ██╔╝", bR: "██║", mid: "    ██╔══██║██╔══██╗██║          ", sl: "██╔╝██╔╝" },
  { bL: "███╗", gt: "██╔╝", bR: "███║", mid: "    ██║  ██║██║  ██║╚██████╗    ", sl: "██╔╝██╔╝" },
  { bL: "╚══╝", gt: "╚═╝", bR: " ╚══╝", mid: "    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝    ", sl: "╚═╝ ╚═╝" },
];

/** Full logo: [>] ARC // — used in WelcomeView and OnboardingScreen */
export function FullLogo() {
  const { theme } = useTheme();
  const { colors } = theme;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {ARC_LOGO.map((seg, i) => (
        <Text key={i}>
          <Text color={colors.primary}>{seg.bL}</Text>
          <Text color={colors.text}>{seg.gt}</Text>
          <Text color={colors.primary}>{seg.bR}{seg.mid}</Text>
          <Text color={colors.text}>{seg.sl}</Text>
        </Text>
      ))}
    </Box>
  );
}

/** Compact logomark: [>] only */
export function LogoMark() {
  const { theme } = useTheme();
  const { colors } = theme;
  return (
    <Box flexDirection="column">
      {ARC_LOGO.map((seg, i) => (
        <Text key={i}>
          <Text color={colors.primary}>{seg.bL}</Text>
          <Text color={colors.text}>{seg.gt}</Text>
          <Text color={colors.primary}>{seg.bR}</Text>
        </Text>
      ))}
    </Box>
  );
}

// Medium: 3-line half-block ARC
const ARC_MEDIUM = [
  "█▀█ █▀█ █▀▀",
  "█▀█ █▀▄ █   ",
  "▀ ▀ ▀ ▀ ▀▀▀",
];


/**
 * Responsive logo for DashView.
 * - Small:  [>] ARC //          (1 line)   height < 26
 * - Medium: half-block ARC      (2 lines)  height 26-31
 * - Large:  block ARC           (6 lines)  height 32-39
 * - Full:   [>] ARC //          (6 lines)  height >= 40
 */
export function LogoWithArc() {
  const { theme } = useTheme();
  const { colors } = theme;
  const { height } = useScreenSize();

  // Small — single-line text
  if (height < 26) {
    return (
      <Box marginBottom={1}>
        <Text color={colors.dimmed}>[</Text>
        <Text color={colors.text} bold>{">"}</Text>
        <Text color={colors.dimmed}>] </Text>
        <Text color={colors.primary} bold>ARC</Text>
        <Text color={colors.dimmed}> //</Text>
      </Box>
    );
  }

  // Medium — 3-line half-block ARC
  if (height < 32) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {ARC_MEDIUM.map((line, i) => (
          <Text key={i} color={colors.primary}>{line}</Text>
        ))}
      </Box>
    );
  }

  // Large — same as full, uses ARC_LOGO with segment coloring
  if (height < 40) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {ARC_LOGO.map((seg, i) => (
          <Text key={i}>
            <Text color={colors.primary}>{seg.bL}</Text>
            <Text color={colors.text}>{seg.gt}</Text>
            <Text color={colors.primary}>{seg.bR}{seg.mid}</Text>
            <Text color={colors.text}>{seg.sl}</Text>
          </Text>
        ))}
      </Box>
    );
  }

  // Full — [>] ARC // with brackets and slashes
  return (
    <Box flexDirection="column" marginBottom={1}>
      {ARC_LOGO.map((seg, i) => (
        <Text key={i}>
          <Text color={colors.primary}>{seg.bL}</Text>
          <Text color={colors.text}>{seg.gt}</Text>
          <Text color={colors.primary}>{seg.bR}{seg.mid}</Text>
          <Text color={colors.text}>{seg.sl}</Text>
        </Text>
      ))}
    </Box>
  );
}
