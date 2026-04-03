export type HealthStatus = "ok" | "pass" | "warn" | "fail";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  summary?: string;
  detail?: string;
  profile?: string;
  component?: string;
  hint?: string;
  tool?: string;
}

export interface HealthReport {
  generatedAt: string;
  status: HealthStatus;
  ok: boolean;
  activeProfile?: string;
  checks: HealthCheck[];
}

export function summarizeHealthStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

export function buildHealthReport(
  checks: HealthCheck[],
  activeProfile?: string
): HealthReport {
  const status = summarizeHealthStatus(checks);
  return {
    generatedAt: new Date().toISOString(),
    status,
    ok: status !== "fail",
    activeProfile,
    checks,
  };
}

export type ArcHealthCheck = HealthCheck;
export type ArcHealthReport = HealthReport;
export const summarizeHealth = buildHealthReport;

export interface HealthSummary {
  status: HealthStatus;
  pass: number;
  warn: number;
  fail: number;
}

export function summarizeHealthChecks(checks: HealthCheck[]): HealthSummary {
  return {
    status: summarizeHealthStatus(checks),
    pass: checks.filter((check) => check.status === "ok" || check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };
}

export function healthStatusToExitCode(status: HealthStatus): number {
  return status === "fail" ? 1 : 0;
}
