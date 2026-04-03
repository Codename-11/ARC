import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Overlay } from "../components/Overlay.js";
import { useTheme } from "../theme.js";
import { captureAccount, swapTo, listAccounts, deleteAccount, type SwapAccount } from "../../swap.js";

interface Props {
  onClose: () => void;
  onSwapped: () => void;
}

export function SwapOverlay({ onClose, onSwapped }: Props) {
  const { theme } = useTheme();
  const { colors } = theme;
  const [accounts, setAccounts] = useState<SwapAccount[]>(() => listAccounts());
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const [captureName, setCaptureName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = () => setAccounts(listAccounts());

  useInput((input, key) => {
    // ── Capture mode: typing a name ──
    if (captureMode) {
      if (key.escape) {
        setCaptureMode(false);
        setCaptureName("");
        return;
      }
      if (key.return) {
        if (!captureName.trim()) return;
        const result = captureAccount(captureName.trim(), "claude");
        if (result.ok) {
          setMessage({ text: `Captured "${captureName.trim()}"`, ok: true });
          reload();
        } else {
          setMessage({ text: result.error, ok: false });
        }
        setCaptureMode(false);
        setCaptureName("");
        return;
      }
      if (key.backspace || key.delete) {
        setCaptureName((n) => n.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input.length === 1) {
        setCaptureName((n) => n + input);
      }
      return;
    }

    // ── Delete confirmation ──
    if (confirmDelete) {
      if (input === "y") {
        const target = accounts[cursor];
        if (target) {
          const result = deleteAccount(target.name);
          if (result.ok) {
            setMessage({ text: `Deleted "${target.name}"`, ok: true });
            reload();
            setCursor((c) => Math.min(c, Math.max(0, accounts.length - 2)));
          } else {
            setMessage({ text: result.error, ok: false });
          }
        }
        setConfirmDelete(false);
        return;
      }
      setConfirmDelete(false);
      return;
    }

    // ── Normal mode ──
    if (key.escape) {
      onClose();
      return;
    }

    setMessage(null);

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(Math.max(0, accounts.length - 1), c + 1));
      return;
    }

    // [c] capture
    if (input === "c") {
      setCaptureMode(true);
      setCaptureName("");
      return;
    }

    // [enter/s] swap to selected
    if ((key.return || input === "s") && accounts.length > 0) {
      const target = accounts[cursor];
      if (!target) return;
      if (target.isActive) {
        setMessage({ text: "Already the active account.", ok: false });
        return;
      }
      const result = swapTo(target.name);
      if (result.ok) {
        setMessage({ text: `Swapped to "${target.name}". Restart agent sessions.`, ok: true });
        reload();
        onSwapped();
      } else {
        setMessage({ text: result.error, ok: false });
      }
      return;
    }

    // [d] delete
    if (input === "d" && accounts.length > 0) {
      const target = accounts[cursor];
      if (target?.isActive) {
        setMessage({ text: "Cannot delete the active account.", ok: false });
        return;
      }
      setConfirmDelete(true);
      return;
    }
  });

  return (
    <Overlay
      title="Credential Hot-Swap"
      subtitle="experimental"
    >
      <Box flexDirection="column">
        {/* Experimental badge */}
        <Box marginBottom={1}>
          <Text backgroundColor="#553300" color="yellow" bold> EXPERIMENTAL </Text>
          <Text color={colors.dimmed}> Swap auth credentials, keep MCPs + settings + history</Text>
        </Box>

        {/* Capture mode */}
        {captureMode && (
          <Box marginBottom={1}>
            <Text color={colors.primary} bold>{"\u203A"} </Text>
            <Text color={colors.dimmed}>Account name: </Text>
            <Text color={colors.text}>{captureName}</Text>
            <Text color={colors.primary}>{"\u258C"}</Text>
          </Box>
        )}

        {/* Account list */}
        {accounts.length === 0 ? (
          <Box marginBottom={1}>
            <Text color={colors.dimmed}>
              No accounts captured yet. Press c to capture your current credentials.
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginBottom={1}>
            {accounts.map((a, i) => {
              const selected = i === cursor;
              return (
                <Box key={a.name} backgroundColor={selected ? colors.bgSelected : undefined}>
                  <Text color={selected ? colors.primary : colors.dimmed}>
                    {selected ? " \u25B8 " : "   "}
                  </Text>
                  <Text color={a.isActive ? colors.success : colors.dimmed}>
                    {a.isActive ? "\u25CF" : "\u25CB"}
                  </Text>
                  <Text> </Text>
                  <Box width={16}>
                    <Text color={selected ? colors.text : colors.dimmed} bold={a.isActive}>
                      {a.name}
                    </Text>
                  </Box>
                  <Text color={colors.dimmed}>{a.tool}</Text>
                  {a.isActive && <Text color={colors.success}> active</Text>}
                </Box>
              );
            })}
          </Box>
        )}

        {/* Delete confirmation */}
        {confirmDelete && accounts[cursor] && (
          <Box marginBottom={1}>
            <Text color={colors.error}>Delete "{accounts[cursor]!.name}"? (y/n)</Text>
          </Box>
        )}

        {/* Status message */}
        {message && (
          <Box marginBottom={1}>
            <Text color={message.ok ? colors.success : colors.error}>{message.text}</Text>
          </Box>
        )}

        {/* Key hints */}
        <Box gap={2}>
          <Box gap={0}>
            <Text color={colors.primary} bold>[c]</Text>
            <Text color={colors.dimmed}> capture</Text>
          </Box>
          {accounts.length > 0 && (
            <>
              <Box gap={0}>
                <Text color={colors.primary} bold>[enter]</Text>
                <Text color={colors.dimmed}> swap</Text>
              </Box>
              <Box gap={0}>
                <Text color={colors.primary} bold>[d]</Text>
                <Text color={colors.dimmed}> delete</Text>
              </Box>
            </>
          )}
          <Box gap={0}>
            <Text color={colors.primary} bold>[esc]</Text>
            <Text color={colors.dimmed}> close</Text>
          </Box>
        </Box>
      </Box>
    </Overlay>
  );
}
