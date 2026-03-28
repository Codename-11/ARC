import { useState, useEffect } from "react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import { useTheme } from "../theme.js";
import { findBinary } from "../../commands/launch.js";
import { getCredentialStatus, type CredentialStatus } from "../../auth.js";
import { loadConfig } from "../../config.js";
import type { AuthType } from "../../types.js";
import type { ProfileEntry } from "../useProfiles.js";

interface ProfileCheck {
  name: string;
  tool: string;
  authType: AuthType;
  binaryFound: boolean;
  credential: CredentialStatus | null;
  credError: boolean;
}

interface SystemCheck {
  pathOk: boolean;
  shellIntegrationOk: boolean;
  shellProfile: string | null;
}

interface Props {
  profiles: ProfileEntry[];
}

// ── Install-hint map ────────────────────────────────────────────────────

const INSTALL_HINTS: Record<string, string> = {
  claude: "npm install -g @anthropic-ai/claude-code",
  gemini: "npm install -g @anthropic-ai/gemini-cli",
  codex: "npm install -g @openai/codex",
};

// ── Auth-repair-hint map ────────────────────────────────────────────────

function getAuthHint(authType: AuthType, profileName: string): string {
  switch (authType) {
    case "oauth":
      return `Run \`arc launch ${profileName}\` to authenticate via browser`;
    case "api-key":
      return `Run \`arc set-key ${profileName}\` to store your API key`;
    case "bedrock":
      return "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars";
    case "vertex":
      return "Set GOOGLE_APPLICATION_CREDENTIALS env var";
    case "foundry":
      return "Set FOUNDRY_API_KEY env var";
  }
}

// ── System-level checks (mirrors src/commands/doctor.ts) ────────────────

type ShellType = "bash" | "zsh" | "fish" | "powershell";

function detectShell(): ShellType {
  if (process.platform === "win32") return "powershell";
  const shellEnv = process.env["SHELL"] ?? "";
  const base = path.basename(shellEnv);
  if (base === "zsh") return "zsh";
  if (base === "fish") return "fish";
  return "bash";
}

function getShellProfilePath(shell: ShellType): string | null {
  const home = os.homedir();
  switch (shell) {
    case "powershell":
      return path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    case "bash":
      return path.join(home, ".bashrc");
    case "zsh":
      return path.join(home, ".zshrc");
    case "fish":
      return path.join(home, ".config", "fish", "config.fish");
  }
}

function runSystemChecks(): SystemCheck {
  // PATH check
  const localBin =
    process.env["ARC_LOCAL_BIN_DIR"] ||
    path.join(os.homedir(), ".local", "bin");
  const envPath = process.env["PATH"] ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const dirs = envPath.split(separator);
  const pathOk = dirs.some((d) => path.normalize(d) === path.normalize(localBin));

  // Shell integration check
  const shell = detectShell();
  const profilePath = getShellProfilePath(shell);
  let shellIntegrationOk = false;

  if (profilePath && fs.existsSync(profilePath)) {
    try {
      const content = fs.readFileSync(profilePath, "utf-8");
      shellIntegrationOk = content.includes("arc shell-init");
    } catch {
      // Treat unreadable profile as missing integration
    }
  }

  return { pathOk, shellIntegrationOk, shellProfile: profilePath };
}

// ── Subcomponents ───────────────────────────────────────────────────────

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

function RepairHint({ hint }: { hint: string }) {
  const { theme } = useTheme();
  const { colors } = theme;

  // Split hint around backtick-delimited commands to highlight them
  const parts = hint.split(/(`[^`]+`)/);

  return (
    <Box paddingLeft={4}>
      <Text color={colors.dimmed}>
        {"-> "}
        {parts.map((part, i) =>
          part.startsWith("`") && part.endsWith("`") ? (
            <Text key={i} color={colors.primary}>{part.slice(1, -1)}</Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        )}
      </Text>
    </Box>
  );
}

// ── Main view ───────────────────────────────────────────────────────────

export function DoctorView({ profiles }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const [checks, setChecks] = useState<ProfileCheck[]>([]);
  const [systemCheck, setSystemCheck] = useState<SystemCheck | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function runChecks() {
      // System-level checks (synchronous)
      const sys = runSystemChecks();
      if (!cancelled) setSystemCheck(sys);

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
        const authType = profile.authType;
        const binaryFound = findBinary(tool);

        let credential: CredentialStatus | null = null;
        let credError = false;

        try {
          credential = await getCredentialStatus(profile);
        } catch {
          credError = true;
        }

        results.push({ name, tool, authType, binaryFound, credential, credError });
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
          <Spinner label="Running diagnostics..." />
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

      {/* System-level checks */}
      {!running && systemCheck && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={colors.primary}>System</Text>
          <CheckRow ok={systemCheck.pathOk} label={systemCheck.pathOk ? "PATH includes arc shim directory" : "Arc shim directory is not on PATH"} />
          {!systemCheck.pathOk && (
            <RepairHint hint="Run `arc setup` to fix PATH" />
          )}
          <CheckRow
            ok={systemCheck.shellIntegrationOk}
            label={
              systemCheck.shellIntegrationOk
                ? `Shell integration found${systemCheck.shellProfile ? ` in ${path.basename(systemCheck.shellProfile)}` : ""}`
                : `Shell integration not found${systemCheck.shellProfile ? ` in ${path.basename(systemCheck.shellProfile)}` : ""}`
            }
          />
          {!systemCheck.shellIntegrationOk && (
            <RepairHint hint="Run `arc setup` to add shell integration" />
          )}
        </Box>
      )}

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
            marginBottom={1}
          >
            <Box gap={2}>
              <Text bold color={colors.primary}>{c.name}</Text>
              <Text color={colors.dimmed}>{c.tool}</Text>
            </Box>
            <CheckRow
              ok={c.binaryFound}
              label={c.binaryFound ? `${c.tool} binary found` : `${c.tool} binary not found`}
            />
            {!c.binaryFound && (
              <RepairHint
                hint={
                  INSTALL_HINTS[c.tool]
                    ? `Install with \`${INSTALL_HINTS[c.tool]}\``
                    : `Install ${c.tool} and ensure it is on your PATH`
                }
              />
            )}
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
            {/* Repair hint: not authenticated */}
            {credOk === false && !c.credError && c.credential !== null && !c.credential.expired && (
              <RepairHint hint={getAuthHint(c.authType, c.name)} />
            )}
            {/* Repair hint: credentials expired */}
            {credOk === "warn" && c.credential?.expired && (
              <RepairHint hint={`Run \`arc launch ${c.name}\` to re-authenticate`} />
            )}
            {/* Repair hint: credential check errored */}
            {c.credError && (
              <RepairHint hint={`Run \`arc doctor\` in your terminal for detailed diagnostics`} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
