import { useEffect, useRef, useState } from "react";

interface Line {
  prompt?: boolean;
  text: string;
  delay: number;
  accent?: boolean;
  dim?: boolean;
  label?: boolean;
}

const LINES: Line[] = [
  { prompt: true, text: "arc dashboard", delay: 0 },
  { text: "", delay: 400 },
  { text: `  ARC v${__ARC_VERSION__}`, accent: true, delay: 600 },
  { text: "  Agent Runtime Control", dim: true, delay: 750 },
  { text: "", delay: 850 },
  { label: true, text: "  PROFILES", delay: 950 },
  { text: "    \u25CF claude-main    Claude Code    active", delay: 1050 },
  { text: "    \u25CB gemini-dev     Gemini CLI", dim: true, delay: 1150 },
  { text: "    \u25CB codex-review   Codex CLI", dim: true, delay: 1250 },
  { text: "", delay: 1350 },
  { label: true, text: "  STATUS", delay: 1450 },
  { text: "    Hooks     8 active     Tasks    2 pending", delay: 1550 },
  { text: "    Memory    847 entries   Sessions 1 running", delay: 1650 },
  { text: "    Sync      up to date   Factory  idle", delay: 1750 },
];

export default function Terminal() {
  const [visibleLines, setVisibleLines] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const triggered = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered.current) {
          triggered.current = true;
          LINES.forEach((line, i) => {
            setTimeout(() => setVisibleLines(i + 1), line.delay);
          });
        }
      },
      { threshold: 0.2 },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-8">
          <p className="font-mono-label text-[11px] text-(--color-text-disabled) mb-3">
            IN ACTION
          </p>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
            <h2 className="text-2xl md:text-3xl font-light text-(--color-text-display) tracking-tight">
              See it run.
            </h2>
            <p className="text-sm text-(--color-text-secondary)">
              Live view of profiles, hooks, tasks, memory, and sessions.
            </p>
          </div>
        </div>

        {/* Terminal window — full width */}
        <div className="border border-(--color-border-visible) rounded-lg overflow-hidden">
          {/* Title bar */}
          <div className="flex items-center gap-1.5 px-4 py-2.5 bg-(--color-surface-raised) border-b border-(--color-border)">
            <div className="w-2 h-2 rounded-full bg-(--color-border-visible)" />
            <div className="w-2 h-2 rounded-full bg-(--color-border-visible)" />
            <div className="w-2 h-2 rounded-full bg-(--color-border-visible)" />
            <span className="font-mono-label text-[10px] text-(--color-text-disabled) ml-2">
              TERMINAL
            </span>
          </div>

          {/* Terminal body */}
          <div className="bg-(--color-surface) p-4 md:p-6 overflow-x-auto">
            <div className="font-mono text-[13px] leading-6 min-w-[480px]">
              {LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.prompt && (
                    <span className="text-(--color-accent) select-none">$ </span>
                  )}
                  <span
                    className={
                      line.accent
                        ? "text-(--color-accent)"
                        : line.label
                          ? "text-(--color-text-disabled) text-[11px] tracking-widest"
                          : line.dim
                            ? "text-(--color-text-secondary)"
                            : "text-(--color-text-primary)"
                    }
                  >
                    {line.text}
                  </span>
                </div>
              ))}
              {visibleLines > 0 && visibleLines < LINES.length && (
                <span className="cursor-blink text-(--color-accent)">▊</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
