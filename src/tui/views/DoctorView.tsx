import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import { useTheme } from "../theme.js";
import { findBinary } from "../../commands/launch.js";
import { getCredentialStatus, type CredentialStatus } from "../../auth.js";
import { loadConfig } from "../../config.js";
import type { ProfileEntry } from "../useProfiles.js";

interface ProfileCheck {
  name: string;
  tool: string;
  binaryFound: boolean;
  credential: CredentialStatus | null;
  credError: boolean;
}

interface Props {
  profiles: ProfileEntry[];
}

function CheckRow({ ok, label }: { ok: boolean | "warn" | "loading"; label: string }) {
  const { theme } = useTheme();
  const { colors } = theme;

  let icon: string;
  let iconColor: string;

  if (ok === "loading") {
    icon = "·";
    iconColor = colors.dimmed;
  } else if (ok === "warn") {
    icon = "⚠";
    iconColor = colors.warning;
  } else if (ok) {
    icon = "✔";
    iconColor = colors.success;
  } else {
    icon = "✖";
    iconColor = colors.error;
  }

  return (
    <Box gap={2}>
      <Text color={iconColor}>{icon}</Text>
      <Text color={ok === true ? colors.text : ok === false ? colors.error : ok === "warn" ? colors.warning : colors.dimmed}>
        {label}
      </Text>
    </Box>
  );
}

export function DoctorView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const [checks, setChecks] = useState<ProfileCheck[]>([]);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function runChecks() {
      let config;
      try {
        config = loadConfig();
      } catch {
        if (!cancelled) setRunning(false);
        return;
      }

      const results: ProfileCheck[] = [];
      const names = Object.keys(config.profiles);

      for (const name of names) {
        const profile = config.profiles[name];
        const tool = profile.tool ?? "claude";
        const binaryFound = findBinary(tool);

        let credential: CredentialStatus | null = null;
        let credError = false;

        try {
          credential = await getCredentialStatus(profile);
        } catch {
          credError = true;
        }

        results.push({ name, tool, binaryFound, credential, credError });
      }

      if (!cancelled) {
        setChecks(results);
        setRunning(false);
      }
    }

    runChecks();
    return () => { cancelled = true; };
  }, [profiles]);

  const passCount = running ? 0 : checks.reduce((n, c) => {
    const credOk = !c.credError && c.credential?.authenticated && !c.credential?.expired;
    return n + (c.binaryFound && credOk ? 1 : 0);
  }, 0);

  return (
    <Box flexDirection="column" gap={1}>
      {/* Summary bar */}
      <Box gap={2} marginBottom={1}>
        {running ? (
          <Spinner label="Running diagnostics…" />
        ) : checks.length === 0 ? (
          <Text color={colors.dimmed}>No profiles configured.</Text>
        ) : (
          <Box gap={2}>
            <Text color={passCount === checks.length ? colors.accent : colors.warning}>
              {passCount === checks.length ? "✔" : "⚠"}
            </Text>
            <Text color={colors.text}>
              {passCount}/{checks.length} profiles healthy
            </Text>
          </Box>
        )}
      </Box>

      {/* Per-profile results */}
      {!running && checks.map((c) => {
        const credOk: boolean | "warn" | "loading" = c.credError
          ? false
          : c.credential === null
            ? "loading"
            : c.credential.expired
              ? "warn"
              : c.credential.authenticated
                ? true
                : false;

        return (
          <Box
            key={c.name}
            flexDirection="column"
            borderStyle="single"
            borderColor={colors.border}
            paddingX={2}
            paddingY={1}
            backgroundColor={colors.bgPanel}
          >
            {/* Profile name header */}
            <Box gap={2} marginBottom={1}>
              <Text bold color={colors.primary}>{c.name}</Text>
              <Text color={colors.border}>│</Text>
              <Text color={colors.dimmed}>{c.tool}</Text>
            </Box>

            {/* Checks */}
            <CheckRow
              ok={c.binaryFound}
              label={c.binaryFound ? `${c.tool} binary found` : `${c.tool} binary not found`}
            />
            <CheckRow
              ok={credOk}
              label={
                c.credError
                  ? "Error checking credentials"
                  : c.credential === null
                    ? "No credential info"
                    : c.credential.authenticated
                      ? `Authenticated (${c.credential.method ?? "unknown"})`
                      : c.credential.expired
                        ? "Credentials expired"
                        : "Not authenticated"
              }
            />
          </Box>
        );
      })}
    </Box>
  );
}
