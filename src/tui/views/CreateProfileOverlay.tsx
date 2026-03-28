import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "@inkjs/ui";
import { Overlay } from "../components/Overlay.js";
import { StepHint } from "../components/StepHint.js";
import { useTheme } from "../theme.js";
import { loadConfig } from "../../config.js";
import { getProfileDir } from "../../paths.js";
import {
  validateName,
  createProfile,
  importProfile,
  TOOL_OPTIONS,
  AUTH_OPTIONS,
  RENDER_DEFER_MS,
  type CreateProfileInput,
} from "../createProfile.js";
import { detectToolConfigs, type DetectedTool } from "../../detect.js";
import {
  getSubtitle,
  type SelectStep, type NamingStep, type ImportingStep,
  type NameStep, type ToolStep, type AuthStep, type ConfirmStep, type CreatingStep,
} from "../wizardTypes.js";

// ── Step machine ────────────────────────────────────────────────────────

type Step =
  | SelectStep
  | NamingStep
  | ImportingStep
  | NameStep
  | ToolStep
  | AuthStep
  | ConfirmStep
  | CreatingStep
  | { id: "error"; message: string; name: string };

// ── Props ───────────────────────────────────────────────────────────────

interface Props {
  existingNames: string[];
  existingTools?: string[];
  onSuccess: (name: string) => void;
  onCancel: () => void;
}

// ── Component ───────────────────────────────────────────────────────────

export function CreateProfileOverlay({ existingNames, existingTools, onSuccess, onCancel }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const [step, setStep] = useState<Step>({ id: "name", value: "", error: null });
  const creatingFired = useRef(false);
  const importingFired = useRef(false);
  const detectRan = useRef(false);

  // On mount, detect unimported tool configs and show the select step if any found
  useEffect(() => {
    if (detectRan.current) return;
    detectRan.current = true;

    const detected = detectToolConfigs();
    const toolSet = new Set(existingTools ?? []);
    const nameSet = new Set(existingNames);
    const unimported = detected.filter(
      (d) => !toolSet.has(d.tool) && !nameSet.has(d.tool)
    );

    if (unimported.length > 0) {
      setStep({ id: "select", detected: unimported, selected: unimported.map(() => true), cursor: 0 });
    }
  }, [existingNames, existingTools]);

  // Handle the async creation step (deferred to let spinner render)
  useEffect(() => {
    if (step.id !== "creating" || creatingFired.current) return;
    creatingFired.current = true;

    setTimeout(() => {
      const result = createProfile(step.input);
      if (result.ok) {
        onSuccess(result.name);
      } else {
        setStep({ id: "error", message: result.error, name: step.input.name });
      }
    }, RENDER_DEFER_MS);
  }, [step, onSuccess]);

  // Handle the async batch import step (yields between each to keep spinner alive)
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
      if (results.length > 0) {
        if (errors.length > 0) {
          // Show partial errors — user presses any key to continue (error step has key handler)
          setStep({ id: "error", message: `Imported ${results.length}, failed ${errors.length}:\n${errors.join("\n")}`, name: results[0]! });
        } else {
          onSuccess(results[0]!);
        }
      } else {
        setStep({ id: "error", message: errors.join("\n"), name: step.queue[0]?.name ?? "" });
      }
    })();
  }, [step, onSuccess]);

  useInput(
    (input, key) => {
      // ── Select step (multi-select) ─────────────────────────────
      if (step.id === "select") {
        const totalItems = step.detected.length + 1;
        if (key.escape) {
          onCancel();
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

      // ── Naming step (review & optional rename) ─────────────────
      if (step.id === "naming") {
        if (step.editing) {
          if (key.escape) {
            setStep({ ...step, editing: false, editValue: "", error: null });
            return;
          }
          if (key.return) {
            const error = validateName(step.editValue, [
              ...existingNames,
              ...step.queue.filter((_, i) => i !== step.cursor).map((q) => q.name),
            ]);
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
        if (key.escape) {
          const detected = step.queue.map((q) => q.tool);
          setStep({ id: "select", detected, selected: detected.map(() => true), cursor: 0 });
          return;
        }
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

      // ── Name step ──────────────────────────────────────────────
      if (step.id === "name") {
        if (key.escape) {
          onCancel();
          return;
        }
        if (key.return) {
          const error = validateName(step.value, existingNames);
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

      // ── Tool step ──────────────────────────────────────────────
      if (step.id === "tool") {
        if (key.escape) {
          onCancel();
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
            // Single auth option — skip selection
            setStep({ id: "confirm", name: step.name, tool, authType: authOptions[0]!.value });
          } else {
            setStep({ id: "auth", selectedIndex: 0, name: step.name, tool });
          }
        }
        return;
      }

      // ── Auth step ──────────────────────────────────────────────
      if (step.id === "auth") {
        const options = AUTH_OPTIONS[step.tool] ?? [];
        if (key.escape) {
          onCancel();
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

      // ── Confirm step ───────────────────────────────────────────
      if (step.id === "confirm") {
        if (key.escape) {
          onCancel();
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

      // ── Error step ─────────────────────────────────────────────
      if (step.id === "error") {
        if (key.escape) {
          // If some imports succeeded, still reload profiles
          const config = loadConfig();
          if (config.profiles[step.name]) {
            onSuccess(step.name);
          } else {
            onCancel();
          }
          return;
        }
        if (key.return) {
          const config = loadConfig();
          if (config.profiles[step.name]) {
            onSuccess(step.name);
          } else {
            setStep({ id: "name", value: step.name, error: null });
          }
          return;
        }
      }
    },
    { isActive: step.id !== "creating" && step.id !== "importing" }
  );

  // ── Render ──────────────────────────────────────────────────────────────

  const subtitle = getSubtitle(step.id);

  return (
    <Overlay title="New Profile" subtitle={subtitle}>
      <Box flexDirection="column">
        {/* ── Select step (multi-select) ────────────── */}
        {step.id === "select" && (
          <>
            <Box marginBottom={1}>
              <Text color={colors.text}>
                Select tools to import, or create a new profile.
              </Text>
            </Box>
            {step.detected.map((dt, i) => {
              const active = i === step.cursor;
              return (
                <Box key={dt.tool} backgroundColor={active ? colors.bgSelected : undefined}>
                  <Text color={active ? colors.primary : colors.dimmed}>
                    {active ? " ▸ " : "   "}
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
                {step.cursor === step.detected.length ? " ▸ " : "   "}
              </Text>
              <Text color={step.cursor === step.detected.length ? colors.text : colors.dimmed}
                bold={step.cursor === step.detected.length}>
                Create new profile instead
              </Text>
            </Box>
            <StepHint keys={[
              { label: "space", desc: "toggle" },
              { label: "a", desc: "all" },
              { label: "enter", desc: "continue" },
              { label: "esc", desc: "cancel" },
            ]} />
          </>
        )}

        {/* ── Naming step (review & optional rename) ── */}
        {step.id === "naming" && (
          <>
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
                    {active ? " ▸ " : "   "}
                  </Text>
                  {isEditing ? (
                    <Box>
                      <Text color={colors.text}>{step.editValue}</Text>
                      <Text color={colors.primary}>{"▌"}</Text>
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
            <StepHint keys={step.editing
              ? [{ label: "enter", desc: "accept" }, { label: "esc", desc: "cancel" }]
              : [
                  { label: "↑↓", desc: "move" },
                  { label: "r", desc: "rename" },
                  { label: "enter", desc: "import all" },
                  { label: "esc", desc: "back" },
                ]
            } />
          </>
        )}

        {/* ── Importing progress ──────────────────────── */}
        {step.id === "importing" && (
          <Box flexDirection="column">
            {step.queue.map((item, i) => {
              if (i >= step.completed) {
                const isCurrent = i === step.completed;
                return (
                  <Box key={i} flexDirection="column">
                    <Box gap={1}>
                      {isCurrent ? <Spinner /> : <Text color={colors.dimmed}>{" "}</Text>}
                      <Text color={isCurrent ? colors.text : colors.dimmed}>{item.name}</Text>
                    </Box>
                    {isCurrent && step.status && (
                      <Box paddingLeft={3}>
                        <Text color={colors.dimmed}>{step.status}</Text>
                      </Box>
                    )}
                  </Box>
                );
              }
              const succeeded = step.results.includes(item.name);
              return (
                <Box key={i} gap={1}>
                  <Text color={succeeded ? colors.success : colors.error}>
                    {succeeded ? "\u2714" : "\u2718"}
                  </Text>
                  <Text color={succeeded ? colors.text : colors.error}>{item.name}</Text>
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

        {/* ── Name input ──────────────────────────────── */}
        {step.id === "name" && (
          <>
            <Box>
              <Text color={colors.primary} bold>{"› "}</Text>
              <Text color={step.value ? colors.text : colors.dimmed}>
                {step.value || "enter a name"}
              </Text>
              <Text color={colors.primary}>{"▌"}</Text>
            </Box>
            {step.error && (
              <Box marginTop={0} paddingLeft={2}>
                <Text color={colors.error}>{step.error}</Text>
              </Box>
            )}
            <StepHint keys={[
              { label: "enter", desc: "next" },
              { label: "esc", desc: "cancel" },
            ]} />
          </>
        )}

        {/* ── Tool selection ──────────────────────────── */}
        {step.id === "tool" && (
          <>
            {TOOL_OPTIONS.map((opt, i) => (
              <Box
                key={opt.value}
                backgroundColor={i === step.selectedIndex ? colors.bgSelected : undefined}
              >
                <Text color={i === step.selectedIndex ? colors.primary : colors.dimmed}>
                  {i === step.selectedIndex ? " ▸ " : "   "}
                </Text>
                <Box width={14}>
                  <Text color={i === step.selectedIndex ? colors.text : colors.dimmed} bold={i === step.selectedIndex}>
                    {opt.label}
                  </Text>
                </Box>
                <Text color={colors.dimmed}>{opt.description}</Text>
              </Box>
            ))}
            <StepHint keys={[
              { label: "↑↓", desc: "move" },
              { label: "enter", desc: "select" },
              { label: "←", desc: "back" },
              { label: "esc", desc: "cancel" },
            ]} />
          </>
        )}

        {/* ── Auth selection ──────────────────────────── */}
        {step.id === "auth" && (
          <>
            {(AUTH_OPTIONS[step.tool] ?? []).map((opt, i) => (
              <Box
                key={opt.value}
                backgroundColor={i === step.selectedIndex ? colors.bgSelected : undefined}
              >
                <Text color={i === step.selectedIndex ? colors.primary : colors.dimmed}>
                  {i === step.selectedIndex ? " ▸ " : "   "}
                </Text>
                <Box width={14}>
                  <Text color={i === step.selectedIndex ? colors.text : colors.dimmed} bold={i === step.selectedIndex}>
                    {opt.label}
                  </Text>
                </Box>
                <Text color={colors.dimmed}>{opt.description}</Text>
              </Box>
            ))}
            <StepHint keys={[
              { label: "↑↓", desc: "move" },
              { label: "enter", desc: "select" },
              { label: "←", desc: "back" },
              { label: "esc", desc: "cancel" },
            ]} />
          </>
        )}

        {/* ── Confirm ─────────────────────────────────── */}
        {step.id === "confirm" && (
          <>
            <Box flexDirection="column" gap={0} paddingLeft={1}>
              <Box gap={1}>
                <Box width={10}><Text color={colors.dimmed}>name</Text></Box>
                <Text color={colors.text} bold>{step.name}</Text>
              </Box>
              <Box gap={1}>
                <Box width={10}><Text color={colors.dimmed}>tool</Text></Box>
                <Text color={colors.text}>{step.tool}</Text>
              </Box>
              <Box gap={1}>
                <Box width={10}><Text color={colors.dimmed}>auth</Text></Box>
                <Text color={colors.text}>{step.authType}</Text>
              </Box>
              <Box gap={1}>
                <Box width={10}><Text color={colors.dimmed}>config</Text></Box>
                <Text color={colors.dimmed}>{getProfileDir(step.name)}</Text>
              </Box>
            </Box>
            <StepHint keys={[
              { label: "enter", desc: "create" },
              { label: "n", desc: "restart" },
              { label: "←", desc: "back" },
              { label: "esc", desc: "cancel" },
            ]} />
          </>
        )}

        {/* ── Creating spinner ────────────────────────── */}
        {step.id === "creating" && (
          <Spinner label="Creating profile..." />
        )}

        {/* ── Error ───────────────────────────────────── */}
        {step.id === "error" && (
          <>
            <Text color={colors.error}>{step.message}</Text>
            <StepHint keys={[
              { label: "enter", desc: "continue" },
              { label: "esc", desc: "close" },
            ]} />
          </>
        )}
      </Box>
    </Overlay>
  );
}
