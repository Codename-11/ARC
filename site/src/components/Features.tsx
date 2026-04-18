import {
  UserCircle,
  Cpu,
  Shield,
  Brain,
  ListTodo,
  LayoutDashboard,
} from "lucide-react";
import type { ReactNode } from "react";

interface Feature {
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    icon: <UserCircle size={18} strokeWidth={1.5} />,
    label: "IDENTITY",
    title: "Profiles & Auth",
    description:
      "Named profiles with isolated credentials, settings, and environments. OAuth, API key, Bedrock, Vertex auth. OS keyring storage.",
  },
  {
    icon: <Cpu size={18} strokeWidth={1.5} />,
    label: "ADAPTERS",
    title: "Multi-Runtime",
    description:
      "Claude Code, Codex CLI, Gemini CLI, OpenClaw, Hermes, and a generic adapter. Native launch for full TUI handoff, worker mode for orchestration, or bare passthrough with no profile.",
  },
  {
    icon: <Shield size={18} strokeWidth={1.5} />,
    label: "SUPERVISION",
    title: "Hook Pipeline",
    description:
      "Four-mode enforcement, risk classification, preflight/postflight hooks, retry loops, and circuit breaker.",
  },
  {
    icon: <Brain size={18} strokeWidth={1.5} />,
    label: "COGNITION",
    title: "Memory & Skills",
    description:
      "Persistent memory with decay scoring. Directory-based skills, MCP-to-skill adapters, self-improving skillify.",
  },
  {
    icon: <ListTodo size={18} strokeWidth={1.5} />,
    label: "ORCHESTRATION",
    title: "Tasks & Sessions",
    description:
      "Task CRUD with cron scheduling and agent-to-agent messaging. Session suspend/resume with resume-intent detection.",
  },
  {
    icon: <LayoutDashboard size={18} strokeWidth={1.5} />,
    label: "OBSERVABILITY",
    title: "Web Dashboard",
    description:
      "REST API, WebSocket real-time push, and a Nothing-designed SPA for deep agent observability.",
  },
];

export default function Features() {
  return (
    <section className="py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-6">
        {/* Section header */}
        <div className="flex items-baseline justify-between mb-10">
          <div>
            <p className="font-mono-label text-[11px] text-(--color-text-disabled) mb-3">
              CAPABILITIES
            </p>
            <h2 className="text-2xl md:text-3xl font-light text-(--color-text-display) tracking-tight">
              Everything agents need.{" "}
              <span className="text-(--color-text-secondary)">Nothing they don't.</span>
            </h2>
          </div>
        </div>

        {/* Feature grid — 1px border grid via container bg */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border border-(--color-border-visible)">
          {features.map((f, i) => (
            <FeatureCard key={f.label} {...f} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ icon, label, title, description, index }: Feature & { index: number }) {
  // Border logic: right border on non-last-in-row, bottom border on top row
  const borderClasses = [
    // Vertical dividers between columns
    index % 3 !== 2 ? "lg:border-r" : "",
    index % 2 !== 1 ? "md:border-r lg:border-r-0" : "md:border-r-0",
    index % 3 !== 2 ? "lg:border-r" : "",
    // Horizontal dividers between rows
    index < 3 ? "border-b" : "",
    // md: 2 cols — top 4 get bottom border
    index < 4 ? "md:border-b" : "md:border-b-0",
    index < 3 ? "lg:border-b" : "lg:border-b-0",
  ].join(" ");

  return (
    <div
      className={`p-6 group hover:bg-(--color-surface) transition-colors duration-200 border-(--color-border-visible) ${borderClasses}`}
    >
      {/* Label row */}
      <div className="flex items-center gap-2.5 mb-4">
        <span className="text-(--color-text-disabled) group-hover:text-(--color-accent) transition-colors duration-200">
          {icon}
        </span>
        <span className="font-mono-label text-[10px] text-(--color-text-disabled)">
          {label}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-base font-medium text-(--color-text-display) mb-2">
        {title}
      </h3>

      {/* Description */}
      <p className="text-sm text-(--color-text-secondary) leading-[1.6]">
        {description}
      </p>
    </div>
  );
}
