import { useEffect, useRef, useState } from "react";

/* ── Data ──────────────────────────────────────────────────────────── */

const INPUTS = [
  { name: "Claude Code", color: "#8B5CF6" },
  { name: "Gemini CLI", color: "#3B82F6" },
  { name: "Codex CLI", color: "#10B981" },
  { name: "OpenClaw", color: "#F59E0B" },
  { name: "Generic", color: "#6B7280" },
];

const OUTPUTS = [
  { name: "Profiles", color: "#6366F1" },
  { name: "Hooks", color: "#F59E0B" },
  { name: "Tasks", color: "#3B82F6" },
  { name: "Memory", color: "#10B981" },
  { name: "Skills", color: "#EC4899" },
  { name: "Orchestration", color: "#8B5CF6" },
];

/* ── Geometry ──────────────────────────────────────────────────────── */

const VB_W = 900;
const VB_H = 500;
const NODE_W = 130;
const NODE_H = 40;
const HUB_R = 44;
const HUB_CX = VB_W / 2;
const HUB_CY = VB_H / 2;

// Distribute nodes vertically, centered around HUB_CY
function distributeY(count: number, gap: number): number[] {
  const totalHeight = (count - 1) * gap;
  const startY = HUB_CY - totalHeight / 2;
  return Array.from({ length: count }, (_, i) => startY + i * gap);
}

const INPUT_X = 60;
const OUTPUT_X = VB_W - NODE_W - 60;
const INPUT_YS = distributeY(INPUTS.length, 66);
const OUTPUT_YS = distributeY(OUTPUTS.length, 60);

/* ── Path builders — smooth curves with consistent entry angles ──── */

function inputPath(i: number): string {
  const sx = INPUT_X + NODE_W;
  const sy = INPUT_YS[i] + NODE_H / 2;
  const ex = HUB_CX - HUB_R;
  const ey = HUB_CY;
  const cx1 = sx + (ex - sx) * 0.45;
  const cx2 = ex - (ex - sx) * 0.25;
  return `M${sx},${sy} C${cx1},${sy} ${cx2},${ey} ${ex},${ey}`;
}

function outputPath(i: number): string {
  const sx = HUB_CX + HUB_R;
  const sy = HUB_CY;
  const ex = OUTPUT_X;
  const ey = OUTPUT_YS[i] + NODE_H / 2;
  const cx1 = sx + (ex - sx) * 0.25;
  const cx2 = ex - (ex - sx) * 0.45;
  return `M${sx},${sy} C${cx1},${sy} ${cx2},${ey} ${ex},${ey}`;
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function FlowDiagram() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.15 },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  const isInputHovered = hovered !== null && INPUTS.some((n) => n.name === hovered);
  const isOutputHovered = hovered !== null && OUTPUTS.some((n) => n.name === hovered);
  const hubHovered = hovered === "ARC";

  function pathActive(side: "input" | "output", name: string) {
    if (hubHovered) return true;
    if (side === "input") return name === hovered || isOutputHovered;
    return name === hovered || isInputHovered;
  }

  function nodeOpacity(name: string) {
    if (!hovered || name === hovered || hubHovered) return 1;
    if (isInputHovered && OUTPUTS.some((o) => o.name === name)) return 1;
    if (isOutputHovered && INPUTS.some((i) => i.name === name)) return 1;
    return 0.25;
  }

  return (
    <section ref={sectionRef} className="py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-10">
          <p className="font-mono-label text-[11px] text-(--color-text-disabled) mb-3">
            ARCHITECTURE
          </p>
          <h2 className="text-2xl md:text-3xl font-light text-(--color-text-display) tracking-tight">
            How it works.
          </h2>
        </div>

        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="w-full"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <defs>
            <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2563EB" stopOpacity="0.12" />
              <stop offset="70%" stopColor="#2563EB" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
            </radialGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="dot-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
            </filter>
          </defs>

          {/* Labels */}
          <text x={INPUT_X + NODE_W / 2} y={INPUT_YS[0] - 18} textAnchor="middle" fill="#666666" fontSize="10" letterSpacing="0.08em">AGENT TOOLS</text>
          <text x={OUTPUT_X + NODE_W / 2} y={OUTPUT_YS[0] - 18} textAnchor="middle" fill="#666666" fontSize="10" letterSpacing="0.08em">CAPABILITIES</text>

          {/* Hub glow */}
          <circle cx={HUB_CX} cy={HUB_CY} r={HUB_R * 2.5} fill="url(#hub-glow)" />

          {/* Connection lines */}
          {visible && (
            <g>
              {INPUTS.map((input, i) => {
                const active = pathActive("input", input.name);
                return (
                  <g key={`in-${i}`}>
                    {active && (
                      <path d={inputPath(i)} fill="none" stroke={input.color} strokeWidth="3" strokeDasharray="8 6" opacity={0.25} filter="url(#glow)">
                        <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="2s" repeatCount="indefinite" />
                      </path>
                    )}
                    <path
                      d={inputPath(i)} fill="none"
                      stroke={active ? input.color : "#333333"}
                      strokeWidth={active ? 1.5 : 1}
                      strokeDasharray="8 6"
                      opacity={!hovered ? 0.5 : active ? 0.9 : 0.12}
                      style={{ transition: "stroke 0.3s, opacity 0.3s" }}
                    >
                      <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="2s" repeatCount="indefinite" />
                    </path>
                  </g>
                );
              })}
              {OUTPUTS.map((output, i) => {
                const active = pathActive("output", output.name);
                return (
                  <g key={`out-${i}`}>
                    {active && (
                      <path d={outputPath(i)} fill="none" stroke={output.color} strokeWidth="3" strokeDasharray="8 6" opacity={0.25} filter="url(#glow)">
                        <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="2s" repeatCount="indefinite" />
                      </path>
                    )}
                    <path
                      d={outputPath(i)} fill="none"
                      stroke={active ? output.color : "#333333"}
                      strokeWidth={active ? 1.5 : 1}
                      strokeDasharray="8 6"
                      opacity={!hovered ? 0.5 : active ? 0.9 : 0.12}
                      style={{ transition: "stroke 0.3s, opacity 0.3s" }}
                    >
                      <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="2s" repeatCount="indefinite" />
                    </path>
                  </g>
                );
              })}
            </g>
          )}

          {/* Connection dots */}
          {visible && (
            <g>
              {INPUTS.map((input, i) => {
                const x = INPUT_X + NODE_W;
                const y = INPUT_YS[i] + NODE_H / 2;
                const active = pathActive("input", input.name);
                return (
                  <g key={`di-${i}`}>
                    {active && <circle cx={x} cy={y} r={10} fill={input.color} opacity={0.15} filter="url(#dot-glow)" />}
                    <circle cx={x} cy={y} r={3.5} fill={active ? input.color : "#444"} style={{ transition: "fill 0.3s" }} />
                  </g>
                );
              })}
              {OUTPUTS.map((output, i) => {
                const x = OUTPUT_X;
                const y = OUTPUT_YS[i] + NODE_H / 2;
                const active = pathActive("output", output.name);
                return (
                  <g key={`do-${i}`}>
                    {active && <circle cx={x} cy={y} r={10} fill={output.color} opacity={0.15} filter="url(#dot-glow)" />}
                    <circle cx={x} cy={y} r={3.5} fill={active ? output.color : "#444"} style={{ transition: "fill 0.3s" }} />
                  </g>
                );
              })}
              {/* Hub dots */}
              <circle cx={HUB_CX - HUB_R} cy={HUB_CY} r={3.5} fill={hovered ? "#2563EB" : "#444"} style={{ transition: "fill 0.3s" }} />
              <circle cx={HUB_CX + HUB_R} cy={HUB_CY} r={3.5} fill={hovered ? "#2563EB" : "#444"} style={{ transition: "fill 0.3s" }} />
            </g>
          )}

          {/* Input nodes */}
          {INPUTS.map((input, i) => (
            <g
              key={input.name}
              onMouseEnter={() => setHovered(input.name)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "default", opacity: nodeOpacity(input.name), transition: "opacity 0.3s" }}
            >
              <rect x={INPUT_X} y={INPUT_YS[i]} width={NODE_W} height={NODE_H} rx={8} ry={8}
                fill="#0A0A0A" stroke={hovered === input.name ? input.color : "#2A2A2A"} strokeWidth={hovered === input.name ? 1.5 : 1}
                style={{ transition: "stroke 0.3s" }} />
              <text x={INPUT_X + NODE_W / 2} y={INPUT_YS[i] + NODE_H / 2 + 4} textAnchor="middle" fill="#E8E8E8" fontSize="12" letterSpacing="0.02em">
                {input.name}
              </text>
            </g>
          ))}

          {/* Hub */}
          <g onMouseEnter={() => setHovered("ARC")} onMouseLeave={() => setHovered(null)} style={{ cursor: "default" }}>
            <circle cx={HUB_CX} cy={HUB_CY} r={HUB_R + 8} fill="none" stroke="#2563EB" strokeWidth="0.5" strokeDasharray="4 4" opacity={0.35}>
              <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="4s" repeatCount="indefinite" />
            </circle>
            <circle cx={HUB_CX} cy={HUB_CY} r={HUB_R} fill="#0A0A0A" stroke="#2563EB" strokeWidth="1.5" />
            <text x={HUB_CX} y={HUB_CY - 3} textAnchor="middle" fill="#E8E8E8" fontSize="16" fontWeight="600" letterSpacing="0.1em">ARC</text>
            <text x={HUB_CX} y={HUB_CY + 14} textAnchor="middle" fill="#2563EB" fontSize="8" letterSpacing="0.1em">RUNTIME</text>
          </g>

          {/* Output nodes */}
          {OUTPUTS.map((output, i) => (
            <g
              key={output.name}
              onMouseEnter={() => setHovered(output.name)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: "default", opacity: nodeOpacity(output.name), transition: "opacity 0.3s" }}
            >
              <rect x={OUTPUT_X} y={OUTPUT_YS[i]} width={NODE_W} height={NODE_H} rx={8} ry={8}
                fill="#0A0A0A" stroke={hovered === output.name ? output.color : "#2A2A2A"} strokeWidth={hovered === output.name ? 1.5 : 1}
                style={{ transition: "stroke 0.3s" }} />
              <text x={OUTPUT_X + NODE_W / 2} y={OUTPUT_YS[i] + NODE_H / 2 + 4} textAnchor="middle" fill="#E8E8E8" fontSize="12" letterSpacing="0.02em">
                {output.name}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
