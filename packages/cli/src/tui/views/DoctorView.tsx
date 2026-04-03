import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import { useTheme } from "../theme.js";
import { collectHealthReport, type HealthReport } from "../../runtime/health-service.js";
import type { HealthStatus } from "@axiom-labs/arc-core";
import type { ProfileEntry } from "../useProfiles.js";

interface Props {
  profiles: ProfileEntry[];
}

function CheckRow({ status, label }: { status: HealthStatus; label: string }) {
  const { theme } = useTheme();
  const { colors } = theme;
  const isGood = status === "pass" || status === "ok";
  const icon = isGood ? "✔" : status === "warn" ? "⚠" : "✖";
  const color = isGood ? colors.success : status === "warn" ? colors.warning : colors.error;

  return (
    <Box gap={2}>
      <Text color={color}>{icon}</Text>
      <Text color={color}>{label}</Text>
    </Box>
  );
}

function Hint({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <Box paddingLeft={4}>
      <Text color={theme.colors.dimmed}>→ {text}</Text>
    </Box>
  );
}

export function DoctorView({ profiles }: Props) {
  const { theme } = useTheme();
  const [report, setReport] = useState<HealthReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    void collectHealthReport().then((nextReport) => {
      if (!cancelled) {
        setReport(nextReport);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  if (!report) {
    return <Spinner label="Running diagnostics..." />;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2} marginBottom={1}>
        <Text color={report.summary.status === "fail" ? theme.colors.error : report.summary.status === "warn" ? theme.colors.warning : theme.colors.success}>
          {report.summary.status === "fail" ? "✖" : report.summary.status === "warn" ? "⚠" : "✔"}
        </Text>
        <Text color={theme.colors.text}>
          {report.summary.pass} pass / {report.summary.warn} warn / {report.summary.fail} fail
        </Text>
      </Box>

      <Text bold color={theme.colors.primary}>System</Text>
      {report.systemChecks.map((check) => (
        <Box key={check.id} flexDirection="column">
          <CheckRow status={check.status} label={check.label} />
          {check.hint && check.status !== "pass" ? <Hint text={check.hint} /> : null}
        </Box>
      ))}

      {report.profileReports.length === 0 ? (
        <Text color={theme.colors.dimmed}>No profiles configured.</Text>
      ) : (
        report.profileReports.map((profile) => (
          <Box key={profile.name} flexDirection="column" marginTop={1}>
            <Box gap={2}>
              <Text bold color={theme.colors.primary}>{profile.name}</Text>
              <Text color={theme.colors.dimmed}>{profile.tool}</Text>
            </Box>
            {profile.checks.map((check) => (
              <Box key={check.id} flexDirection="column">
                <CheckRow status={check.status} label={check.label} />
                {check.hint && check.status !== "pass" ? <Hint text={check.hint} /> : null}
              </Box>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}

