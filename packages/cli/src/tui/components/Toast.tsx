import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { ToastItem, ToastKind } from "../useToast.js";

function colorForKind(
  kind: ToastKind,
  colors: ReturnType<typeof useTheme>["theme"]["colors"]
): string {
  switch (kind) {
    case "success":
      return colors.success;
    case "error":
      return colors.error;
    case "warn":
      return colors.warning;
    case "info":
    default:
      return colors.primary;
  }
}

function iconForKind(kind: ToastKind): string {
  switch (kind) {
    case "success":
      return "\u2714";
    case "error":
      return "\u2716";
    case "warn":
      return "\u26A0";
    case "info":
    default:
      return "\u2139";
  }
}

interface ToastProps {
  toast: ToastItem;
}

export function Toast({ toast }: ToastProps) {
  const { theme } = useTheme();
  const color = colorForKind(toast.kind, theme.colors);

  return (
    <Box
      borderStyle="round"
      borderColor={color}
      backgroundColor={theme.colors.bgPanel}
      paddingX={1}
    >
      <Text color={color}>{iconForKind(toast.kind)} </Text>
      <Text color={theme.colors.text}>{toast.message}</Text>
    </Box>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </Box>
  );
}
