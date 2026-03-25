import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export type ThemeName = "dark" | "light";

export interface ThemeColors {
  primary: string;
  secondary: string;
  text: string;
  dimmed: string;
  border: string;
  borderFocused: string;
  accent: string;
  warning: string;
  error: string;
  activeBg: string;
  success: string;
  // Background tones (hex for Ink's backgroundColor prop)
  bg: string;
  bgPanel: string;
  bgSelected: string;
}

export interface Theme {
  name: ThemeName;
  colors: ThemeColors;
}

// ── Theme definitions ──────────────────────────────────────────────────

export const DARK_THEME: Theme = {
  name: "dark",
  colors: {
    primary: "#7dd3fc",      // sky-300 — bright cyan-blue
    secondary: "#c084fc",    // purple-400
    text: "#e2e8f0",         // slate-200
    dimmed: "#64748b",       // slate-500
    border: "#334155",       // slate-700
    borderFocused: "#7dd3fc",// sky-300 (matches primary)
    accent: "#4ade80",       // green-400
    warning: "#fbbf24",      // amber-400
    error: "#f87171",        // red-400
    activeBg: "#0f172a",     // slate-900
    success: "#4ade80",      // green-400
    bg: "#0f172a",           // slate-900
    bgPanel: "#1e293b",      // slate-800
    bgSelected: "#1e3a5f",   // deep blue highlight
  },
};

export const LIGHT_THEME: Theme = {
  name: "light",
  colors: {
    primary: "#2563eb",      // blue-600
    secondary: "#7c3aed",    // violet-600
    text: "#1e293b",         // slate-800
    dimmed: "#94a3b8",       // slate-400
    border: "#cbd5e1",       // slate-300
    borderFocused: "#2563eb",// blue-600
    accent: "#16a34a",       // green-600
    warning: "#d97706",      // amber-600
    error: "#dc2626",        // red-600
    activeBg: "#dbeafe",     // blue-100
    success: "#16a34a",      // green-600
    bg: "#f8fafc",           // slate-50
    bgPanel: "#f1f5f9",      // slate-100
    bgSelected: "#dbeafe",   // blue-100
  },
};

// ── Context ────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ── Provider ───────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeName, setThemeName] = useState<ThemeName>("dark");

  const toggleTheme = useCallback(() => {
    setThemeName((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const theme = themeName === "dark" ? DARK_THEME : LIGHT_THEME;
  const isDark = themeName === "dark";

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
