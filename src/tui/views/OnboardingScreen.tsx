import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useScreenSize } from "fullscreen-ink";
import { Spinner } from "@inkjs/ui";
import { useTheme } from "../theme.js";
import { StepHint } from "../components/StepHint.js";
import { FullLogo } from "../components/ArcLogo.js";
import { VERSION } from "../../version.js";
import { detectToolConfigs, type DetectedTool } from "../../detect.js";
import {
  validateName,
  createProfile,
  importProfile,
  TOOL_OPTIONS,
  AUTH_OPTIONS,
  RENDER_DEFER_MS,
  type CreateProfileInput,
} from "../createProfile.js";
import { getProfileDir } from "../../paths.js";
import {
  getSubtitle,
  type SelectStep, type NamingStep, type ImportingStep,
  type NameStep, type ToolStep, type AuthStep, type ConfirmStep, type CreatingStep,
} from "../wizardTypes.js";

// ── Step machine ──────────────────────────────────────────────────────

type Step =
  | { id: "welcome"; detected: DetectedTool[] }
  | SelectStep
  | NamingStep
  | ImportingStep
  | NameStep
  | ToolStep
  | AuthStep
  | ConfirmStep
  | CreatingStep
  | { id: "done"; names: string[]; errors: string[] };

// ── Props ─────────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
}

// ── Component ─────────────────────────────────────────────────────────

export function OnboardingScreen({ onComplete }: Props) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { colors } = theme;
  const { width, height } = useScreenSize();
  const { exit } = useApp();

  const [step, setStep] = useState<Step>(() => {
    const detected = detectToolConfigs();
    return { id: "welcome", detected };
  });

  const creatingFired = useRef(false);
  const importingFired = useRef(false);

  // ── Async: create profile (deferred to let spinner render) ────────
  useEffect(() => {
    if (step.id !== "creating" || creatingFired.current) return;
    creatingFired.current = true;

    setTimeout(() => {
      const result = createProfile(step.input);
      if (result.ok) {
        setStep({ id: "done", names: [result.name], errors: [] });
      } else {
        setStep({ id: "name", value: step.input.name, error: result.error });
      }
    }, RENDER_DEFER_MS);
  }, [step]);

  // ── Async: batch import (yields between each to keep spinner alive) ─
  useEffect(() => {
    if (step.id !== "importing" || importingFired.current) return;
    importingFired.current = true;

    (async () => {
      const results: string[] = [];
      const errors: string[] = [];
      for (let i = 0; i < step.queue.length; i++) {
        const item = step.queue[i]!;
        const result = await importProfile({
          name: item.name,
          tool: item.tool.tool,
          configDir: item.tool.configDir,
          onProgress: (msg) => {
            setStep((prev) => {
              if (prev.id !== "importing") return prev;
              return { ...prev, status: msg };
            });
          },
        });
        if (result.ok) {
          results.push(result.name);
        } else {
          errors.push(`${item.name}: ${result.error}`);
        }
        setStep((prev) => {
          if (prev.id !== "importing") return prev;
          return { ...prev, completed: i + 1, results: [...results], errors: [...errors], status: "" };
        });
      }
      if (results.length > 0 || errors.length > 0) {
        setStep({ id: "done", names: results, errors });
      } else {
        setStep({ id: "name", value: "", error: "Import failed. Create a profile manually." });
      }
    })();
  }, [step]);

  // ── Auto-transition from done (only if no errors to review) ────────
  useEffect(() => {
    if (step.id !== "done") return;
    if (step.errors.length > 0) return; // Let user review errors first
    const timer = setTimeout(() => onComplete(), 1200);
    return () => clearTimeout(timer);
  }, [step, onComplete]);

  // ── Input handling ─────────────────────────────────────────────────
  useInput(
    (input, key) => {
      // Global: theme toggle
      if (key.ctrl && input === "t") {
        toggleTheme();
        return;
      }

      // ── Welcome ───────────────────────────────────────────────
      if (step.id === "welcome") {
        if (key.escape || (key.ctrl && input === "q")) {
          exit();
          return;
        }
        if (key.return) {
          if (step.detected.length > 0) {
            setStep({
              id: "select",
              detected: step.detected,
              selected: step.detected.map(() => true),
              cursor: 0,
            });
          } else {
            setStep({ id: "name", value: "", error: null });
          }
        }
        return;
      }

      // ── Select (multi-select) ──────────────────────────────────
      if (step.id === "select") {
        const totalItems = step.detected.length + 1; // +1 for "Create new"
        if (key.escape || (key.ctrl && input === "q")) {
          exit();
          return;
        }
        if (key.upArrow) {
          setStep({ ...step, cursor: Math.max(0, step.cursor - 1) });
          return;
        }
        if (key.downArrow) {
          setStep({ ...step, cursor: Math.min(totalItems - 1, step.cursor + 1) });
          return;
        }
        if (input === " " && step.cursor < step.detected.length) {
          const sel = [...step.selected];
          sel[step.cursor] = !sel[step.cursor];
          setStep({ ...step, selected: sel });
          return;
        }
        if (input === "a") {
          const allOn = step.selected.every(Boolean);
          setStep({ ...step, selected: step.detected.map(() => !allOn) });
          return;
        }
        if (key.return) {
          if (step.cursor === step.detected.length) {
            // "Create new profile"
            setStep({ id: "name", value: "", error: null });
            return;
          }
          const chosen = step.detected.filter((_, i) => step.selected[i]);
          if (chosen.length === 0) return;
          setStep({
            id: "naming",
            queue: chosen.map((t) => ({ tool: t, name: t.tool })),
            cursor: 0,
            editing: false,
            editValue: "",
            error: null,
          });
        }
        return;
      }

      // ── Naming (optional rename before import) ─────────────────
      if (step.id === "naming") {
        if (key.escape) {
          // Back to select
          const detected = step.queue.map((q) => q.tool);
          setStep({
            id: "select",
            detected,
            selected: detected.map(() => true),
            cursor: 0,
          });
          return;
        }
        if (step.editing) {
          if (key.return) {
            const error = validateName(step.editValue, step.queue.filter((_, i) => i !== step.cursor).map((q) => q.name));
            if (error) {
              setStep({ ...step, error });
              return;
            }
            const queue = [...step.queue];
            queue[step.cursor] = { ...queue[step.cursor]!, name: step.editValue };
            setStep({ ...step, queue, editing: false, editValue: "", error: null });
            return;
          }
          if (key.backspace || key.delete) {
            setStep({ ...step, editValue: step.editValue.slice(0, -1), error: null });
            return;
          }
          if (!key.ctrl && !key.meta && input.length === 1) {
            setStep({ ...step, editValue: step.editValue + input, error: null });
          }
          return;
        }
        // Not editing
        if (key.upArrow) {
          setStep({ ...step, cursor: Math.max(0, step.cursor - 1) });
          return;
        }
        if (key.downArrow) {
          setStep({ ...step, cursor: Math.min(step.queue.length - 1, step.cursor + 1) });
          return;
        }
        if (input === "r" || input === "e") {
          setStep({ ...step, editing: true, editValue: step.queue[step.cursor]!.name, error: null });
          return;
        }
        if (key.return) {
          importingFired.current = false;
          setStep({ id: "importing", queue: step.queue, completed: 0, results: [], errors: [], status: "" });
        }
        return;
      }

      // ── Name ──────────────────────────────────────────────────
      if (step.id === "name") {
        if (key.escape || (key.ctrl && input === "q")) {
          exit();
          return;
        }
        if (key.return) {
          const error = validateName(step.value, []);
          if (error) {
            setStep({ ...step, error });
          } else {
            setStep({ id: "tool", selectedIndex: 0, name: step.value });
          }
          return;
        }
        if (key.backspace || key.delete) {
          setStep({ id: "name", value: step.value.slice(0, -1), error: null });
          return;
        }
        if (!key.ctrl && !key.meta && input.length === 1) {
          setStep({ id: "name", value: step.value + input, error: null });
        }
        return;
      }

      // ── Tool ──────────────────────────────────────────────────
      if (step.id === "tool") {
        if (key.escape || (key.ctrl && input === "q")) {
          exit();
          return;
        }
        if (key.leftArrow) {
          setStep({ id: "name", value: step.name, error: null });
          return;
        }
        if (key.upArrow) {
          setStep({ ...step, selectedIndex: Math.max(0, step.selectedIndex - 1) });
          return;
        }
        if (key.downArrow) {
          setStep({ ...step, selectedIndex: Math.min(TOOL_OPTIONS.length - 1, step.selectedIndex + 1) });
          return;
        }
        if (key.return) {
          const tool = TOOL_OPTIONS[step.selectedIndex]!.value;
          const authOptions = AUTH_OPTIONS[tool] ?? [];
          if (authOptions.length === 1) {
            setStep({ id: "confirm", name: step.name, tool, authType: authOptions[0]!.value });
          } else {
            setStep({ id: "auth", selectedIndex: 0, name: step.name, tool });
          }
        }
        return;
      }

      // ── Auth ──────────────────────────────────────────────────
      if (step.id === "auth") {
        const options = AUTH_OPTIONS[step.tool] ?? [];
        if (key.escape || (key.ctrl && input === "q")) {
          exit();
          return;
        }
        if (key.leftArrow) {
          setStep({ id: "tool", selectedIndex: 0, name: step.name });
          return;
        }
        if (key.upArrow) {
          setStep({ ...step, selectedIndex: Math.max(0, step.selectedIndex - 1) });
          return;
        }
        if (key.downArrow) {
          setStep({ ...step, selectedIndex: Math.min(options.length - 1, step.selectedIndex + 1) });
          return;
        }
        if (key.return) {
          const authType = options[step.selectedIndex]!.value;
          setStep({ id: "confirm", name: step.name, tool: step.tool, authType });
        }
        return;
      }

      // ── Confirm ───────────────────────────────────────────────
      if (step.id === "confirm") {
        if (key.escape || (key.ctrl && input === "q")) {
          exit();
          return;
        }
        if (key.leftArrow) {
          setStep({ id: "tool", selectedIndex: 0, name: step.name });
          return;
        }
        if (key.return || input === "y") {
          creatingFired.current = false;
          setStep({
            id: "creating",
            input: { name: step.name, tool: step.tool, authType: step.authType },
          });
          return;
        }
        if (input === "n") {
          setStep({ id: "name", value: step.name, error: null });
        }
        return;
      }

      // ── Done with errors — wait for user to acknowledge ─────
      if (step.id === "done" && step.errors.length > 0) {
        if (key.return || key.escape) {
          onComplete();
        }
        return;
      }
    },
    { isActive: step.id !== "creating" && step.id !== "importing" && !(step.id === "done" && step.errors.length === 0) }
  );

  // ── Step metadata ──────────────────────────────────────────────────

  const subtitle = getSubtitle(step.id);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={colors.bg}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <Box paddingX={2}>
        <Box flexGrow={1} gap={1}>
          <Text color={colors.dimmed}>[</Text>
          <Text color={colors.primary} bold>{">"}</Text>
          <Text color={colors.dimmed}>]</Text>
          <Text bold color={colors.primary}> ARC</Text>
          <Text color={colors.dimmed}>Setup</Text>
        </Box>
        <Text color={colors.dimmed}>
          v{VERSION} · {isDark ? "carbon" : "photon"}
        </Text>
      </Box>
      <Box>
        <Text color={colors.border}>
          {"\u2500".repeat(width)}
        </Text>
      </Box>

      {/* ── Main content ───────────────────────────────────────── */}
      <Box flexDirection="column" flexGrow={1} paddingX={4} paddingY={1}>
        {/* Logo (always visible) */}
        <FullLogo />

        {/* Step indicator (not on welcome/done) */}
        {step.id !== "welcome" && step.id !== "done" && (
          <Box marginBottom={1}>
            <Text color={colors.dimmed}>{subtitle}</Text>
          </Box>
        )}

        {/* ── Welcome step ─────────────────────────────────────── */}
        {step.id === "welcome" && (
          <Box flexDirection="column">
            <Box marginBottom={1} flexDirection="column">
              <Text color={colors.text} bold>
                Welcome to ARC — (Agent Runtime Control)
              </Text>
              <Text color={colors.dimmed}>
                Manage agent profiles for Claude, Gemini, Codex, and more.
              </Text>
            </Box>

            {step.detected.length > 0 ? (
              <Box flexDirection="column" marginBottom={1}>
                <Box gap={1} marginBottom={0}>
                  <Text color={colors.dimmed}>detected tools</Text>
                  <Text color={colors.border}>
                    {"\u2500".repeat(14)}
                  </Text>
                </Box>
                <Box flexDirection="column" paddingLeft={2}>
                  {step.detected.map((d) => (
                    <Box key={d.tool} gap={1}>
                      <Text color={colors.success}>{"\u2714"}</Text>
                      <Box width={16}>
                        <Text color={colors.text}>{d.displayName}</Text>
                      </Box>
                      <Text color={colors.dimmed}>{d.configDir}</Text>
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <Box marginBottom={1}>
                <Text color={colors.dimmed}>
                  No existing tool configs detected.
                </Text>
              </Box>
            )}

            <StepHint
              keys={[
                {
                  label: "enter",
                  desc:
                    step.detected.length > 0
                      ? "import or create profile"
                      : "create your first profile",
                },
                { label: "ctrl+t", desc: "theme" },
                { label: "ctrl+q", desc: "quit" },
              ]}
            />
          </Box>
        )}

        {/* ── Select step (multi-select) ─────────────────────── */}
        {step.id === "select" && (
          <Box flexDirection="column">
            {step.detected.map((dt, i) => {
              const active = i === step.cursor;
              return (
                <Box key={dt.tool} backgroundColor={active ? colors.bgSelected : undefined}>
                  <Text color={active ? colors.primary : colors.dimmed}>
                    {active ? " \u25B8 " : "   "}
                  </Text>
                  <Text color={step.selected[i] ? colors.success : colors.dimmed}>
                    {step.selected[i] ? "[x]" : "[ ]"}
                  </Text>
                  <Text> </Text>
                  <Box width={16}>
                    <Text color={active ? colors.text : colors.dimmed} bold={active}>
                      {dt.displayName}
                    </Text>
                  </Box>
                  <Text color={colors.dimmed}>{dt.configDir}</Text>
                </Box>
              );
            })}
            <Box backgroundColor={step.cursor === step.detected.length ? colors.bgSelected : undefined}>
              <Text color={step.cursor === step.detected.length ? colors.primary : colors.dimmed}>
                {step.cursor === step.detected.length ? " \u25B8 " : "   "}
              </Text>
              <Text color={step.cursor === step.detected.length ? colors.text : colors.dimmed}
                bold={step.cursor === step.detected.length}>
                Create new profile instead
              </Text>
            </Box>
            <StepHint
              keys={[
                { label: "space", desc: "toggle" },
                { label: "a", desc: "all" },
                { label: "enter", desc: "continue" },
                { label: "ctrl+q", desc: "quit" },
              ]}
            />
          </Box>
        )}

        {/* ── Naming step (review & optional rename) ──────────── */}
        {step.id === "naming" && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text color={colors.text}>
                Review profile names (enter to import, r to rename):
              </Text>
            </Box>
            {step.queue.map((item, i) => {
              const active = i === step.cursor;
              const isEditing = active && step.editing;
              return (
                <Box key={i} backgroundColor={active ? colors.bgSelected : undefined}>
                  <Text color={active ? colors.primary : colors.dimmed}>
                    {active ? " \u25B8 " : "   "}
                  </Text>
                  {isEditing ? (
                    <Box>
                      <Text color={colors.text}>{step.editValue}</Text>
                      <Text color={colors.primary}>{"\u258C"}</Text>
                    </Box>
                  ) : (
                    <Box width={20}>
                      <Text color={active ? colors.text : colors.dimmed} bold={active}>
                        {item.name}
                      </Text>
                    </Box>
                  )}
                  <Text color={colors.dimmed}> {"\u2190"} {item.tool.displayName}</Text>
                </Box>
              );
            })}
            {step.error && (
              <Box paddingLeft={2}>
                <Text color={colors.error}>{step.error}</Text>
              </Box>
            )}
            <StepHint
              keys={step.editing
                ? [{ label: "enter", desc: "accept" }, { label: "esc", desc: "cancel" }]
                : [
                    { label: "\u2191\u2193", desc: "move" },
                    { label: "r", desc: "rename" },
                    { label: "enter", desc: "import all" },
                    { label: "esc", desc: "back" },
                  ]
              }
            />
          </Box>
        )}

        {/* ── Name step ────────────────────────────────────────── */}
        {step.id === "name" && (
          <Box flexDirection="column">
            <Box>
              <Text color={colors.primary} bold>
                {"\u203A "}
              </Text>
              <Text color={step.value ? colors.text : colors.dimmed}>
                {step.value || "enter a name"}
              </Text>
              <Text color={colors.primary}>{"\u258C"}</Text>
            </Box>
            {step.error && (
              <Box paddingLeft={2}>
                <Text color={colors.error}>{step.error}</Text>
              </Box>
            )}
            <StepHint
              keys={[
                { label: "enter", desc: "next" },
                { label: "ctrl+q", desc: "quit" },
              ]}
            />
          </Box>
        )}

        {/* ── Tool step ────────────────────────────────────────── */}
        {step.id === "tool" && (
          <Box flexDirection="column">
            {TOOL_OPTIONS.map((opt, i) => (
              <Box
                key={opt.value}
                backgroundColor={
                  i === step.selectedIndex ? colors.bgSelected : undefined
                }
              >
                <Text
                  color={
                    i === step.selectedIndex ? colors.primary : colors.dimmed
                  }
                >
                  {i === step.selectedIndex ? " \u25B8 " : "   "}
                </Text>
                <Box width={14}>
                  <Text
                    color={
                      i === step.selectedIndex ? colors.text : colors.dimmed
                    }
                    bold={i === step.selectedIndex}
                  >
                    {opt.label}
                  </Text>
                </Box>
                <Text color={colors.dimmed}>{opt.description}</Text>
              </Box>
            ))}
            <StepHint
              keys={[
                { label: "\u2191\u2193", desc: "move" },
                { label: "enter", desc: "select" },
                { label: "\u2190", desc: "back" },
                { label: "ctrl+q", desc: "quit" },
              ]}
            />
          </Box>
        )}

        {/* ── Auth step ────────────────────────────────────────── */}
        {step.id === "auth" && (
          <Box flexDirection="column">
            {(AUTH_OPTIONS[step.tool] ?? []).map((opt, i) => (
              <Box
                key={opt.value}
                backgroundColor={
                  i === step.selectedIndex ? colors.bgSelected : undefined
                }
              >
                <Text
                  color={
                    i === step.selectedIndex ? colors.primary : colors.dimmed
                  }
                >
                  {i === step.selectedIndex ? " \u25B8 " : "   "}
                </Text>
                <Box width={14}>
                  <Text
                    color={
                      i === step.selectedIndex ? colors.text : colors.dimmed
                    }
                    bold={i === step.selectedIndex}
                  >
                    {opt.label}
                  </Text>
                </Box>
                <Text color={colors.dimmed}>{opt.description}</Text>
              </Box>
            ))}
            <StepHint
              keys={[
                { label: "\u2191\u2193", desc: "move" },
                { label: "enter", desc: "select" },
                { label: "\u2190", desc: "back" },
                { label: "ctrl+q", desc: "quit" },
              ]}
            />
          </Box>
        )}

        {/* ── Confirm step ─────────────────────────────────────── */}
        {step.id === "confirm" && (
          <Box flexDirection="column">
            <Box flexDirection="column" paddingLeft={1}>
              <Box gap={1}>
                <Box width={10}>
                  <Text color={colors.dimmed}>name</Text>
                </Box>
                <Text color={colors.text} bold>
                  {step.name}
                </Text>
              </Box>
              <Box gap={1}>
                <Box width={10}>
                  <Text color={colors.dimmed}>tool</Text>
                </Box>
                <Text color={colors.text}>{step.tool}</Text>
              </Box>
              <Box gap={1}>
                <Box width={10}>
                  <Text color={colors.dimmed}>auth</Text>
                </Box>
                <Text color={colors.text}>{step.authType}</Text>
              </Box>
              <Box gap={1}>
                <Box width={10}>
                  <Text color={colors.dimmed}>config</Text>
                </Box>
                <Text color={colors.dimmed}>{getProfileDir(step.name)}</Text>
              </Box>
            </Box>
            <StepHint
              keys={[
                { label: "enter", desc: "create" },
                { label: "n", desc: "restart" },
                { label: "\u2190", desc: "back" },
                { label: "ctrl+q", desc: "quit" },
              ]}
            />
          </Box>
        )}

        {/* ── Creating spinner ─────────────────────────────────── */}
        {step.id === "creating" && <Spinner label="Creating profile..." />}

        {/* ── Importing progress ───────────────────────────────── */}
        {step.id === "importing" && (
          <Box flexDirection="column">
            {step.queue.map((item, i) => {
              if (i >= step.completed) {
                const isCurrent = i === step.completed;
                return (
                  <Box key={i} flexDirection="column">
                    <Box gap={1}>
                      {isCurrent ? (
                        <Spinner />
                      ) : (
                        <Text color={colors.dimmed}>{" "}</Text>
                      )}
                      <Text color={isCurrent ? colors.text : colors.dimmed}>
                        {item.name}
                      </Text>
                      {isCurrent && <Text color={colors.dimmed}> {"\u2190"} {item.tool.displayName}</Text>}
                    </Box>
                    {isCurrent && step.status && (
                      <Box paddingLeft={3}>
                        <Text color={colors.dimmed}>{step.status}</Text>
                      </Box>
                    )}
                  </Box>
                );
              }
              // Completed — check if success or error
              const succeeded = step.results.includes(item.name);
              return (
                <Box key={i} gap={1}>
                  <Text color={succeeded ? colors.success : colors.error}>
                    {succeeded ? "\u2714" : "\u2718"}
                  </Text>
                  <Text color={succeeded ? colors.text : colors.error}>
                    {item.name}
                  </Text>
                  {!succeeded && (
                    <Text color={colors.dimmed}>
                      {step.errors.find((e) => e.startsWith(item.name + ":"))?.slice(item.name.length + 2) ?? "failed"}
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        {/* ── Done ─────────────────────────────────────────────── */}
        {step.id === "done" && (
          <Box flexDirection="column">
            {step.names.map((n) => (
              <Box key={n} gap={1}>
                <Text color={colors.success}>{"\u2714"}</Text>
                <Text color={colors.text} bold>
                  Profile &quot;{n}&quot; created
                </Text>
              </Box>
            ))}
            {step.errors.map((e, i) => (
              <Box key={`err-${i}`} gap={1}>
                <Text color={colors.error}>{"\u2718"}</Text>
                <Text color={colors.error}>{e}</Text>
              </Box>
            ))}
            <Box marginTop={1}>
              {step.errors.length > 0 ? (
                <Text color={colors.dimmed}>Press enter to continue to dashboard.</Text>
              ) : (
                <Text color={colors.dimmed}>Entering dashboard...</Text>
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <Box>
        <Text color={colors.border}>
          {"\u2500".repeat(width)}
        </Text>
      </Box>
      <Box paddingX={2} justifyContent="space-between">
        <Text color={colors.dimmed}>Agent Runtime Control — Setup</Text>
        <Text color={colors.dimmed}>{subtitle}</Text>
      </Box>
    </Box>
  );
}
