import { getDoctorSystemStatus, getRuntimeHealthReport } from "../../packages/cli/src/services/health.js";
import { logAction } from "../log.js";

export async function handleHealth(opts: { profile?: string; json?: boolean } = {}): Promise<void> {
  const runtime = await getRuntimeHealthReport();
  const system = getDoctorSystemStatus();
  const systemChecks = [
    { id: "node-version", label: "Node version", status: system.nodeVersionOk ? "pass" : "warn", detail: system.nodeVersionMessage },
    { id: "path", label: "PATH", status: system.pathOk ? "pass" : "warn", detail: system.pathOk ? "ARC shim directory found on PATH" : "ARC shim directory missing from PATH" },
    { id: "shell-integration", label: "Shell integration", status: system.shellIntegrationOk ? "pass" : "warn", detail: system.shellIntegrationOk ? "Shell integration detected" : "Shell integration missing" }
  ];

  const profileReports = Object.entries(
    runtime.checks.filter((check) => check.profile).reduce((acc, check) => {
      const key = check.profile as string;
      if (!acc[key]) acc[key] = [];
      acc[key].push(check);
      return acc;
    }, {} as Record<string, typeof runtime.checks>)
  ).map(([name, checks]) => ({
    name,
    checks,
  }));

  const payload = {
    summary: {
      status: runtime.status,
      ok: runtime.ok,
      activeProfile: runtime.activeProfile,
    },
    systemChecks,
    profileReports,
  };

  logAction("health.completed", runtime.status, {
    component: "health",
    profile: opts.profile ?? runtime.activeProfile,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(`Health status: ${runtime.status}\n`);
    for (const check of systemChecks) {
      process.stdout.write(`- [${check.status}] ${check.label}: ${check.detail}\n`);
    }
    for (const check of runtime.checks) {
      process.stdout.write(`- [${check.status}] ${check.label}: ${check.summary ?? check.detail ?? ""}\n`);
    }
  }

  process.exitCode = runtime.ok ? 0 : 1;
}
