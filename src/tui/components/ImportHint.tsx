import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { detectToolConfigs, type DetectedTool } from "../../detect.js";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
}

export function ImportHint({ profiles }: Props) {
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
        <Text color="yellow">{"💡"} </Text>
        <Text>
          Found {names} config{plural ? "s" : ""}. Run{" "}
        </Text>
        <Text bold color="cyan">
          arc import --all
        </Text>
        <Text> to import.</Text>
      </Text>
    </Box>
  );
}
