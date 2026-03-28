import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import { detectToolConfigs, type DetectedTool } from "../../detect.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
}

export function ImportHint({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const [unimported, setUnimported] = useState<DetectedTool[]>([]);

  useEffect(() => {
    const detected = detectToolConfigs();
    const existingTools = new Set(profiles.map((p) => p.tool));
    const missing = detected.filter((d) => !existingTools.has(d.tool));
    setUnimported(missing);
  }, [profiles]);

  if (unimported.length === 0) {
    return null;
  }

  const names = unimported.map((d) => d.displayName).join(", ");
  const plural = unimported.length > 1;

  return (
    <Box paddingLeft={2} paddingTop={1}>
      <Text>
        <Text>{"💡"} </Text>
        <Text color={colors.text}>
          Found {names} config{plural ? "s" : ""}. Press{" "}
        </Text>
        <Text bold color={colors.primary}>c</Text>
        <Text color={colors.text}> to import.</Text>
      </Text>
    </Box>
  );
}
