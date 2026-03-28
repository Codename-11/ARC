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
// Carbon Night — aligned with Rust DarkCarbonNight spec
export const DARK_THEME: Theme = {
  name: "dark",
  colors: {
    primary: "#25C2FF",      // bright cyan — main accent
    secondary: "#B392F0",    // soft lavender
    text: "#E6EDF3",         // carbon foreground
    dimmed: "#8B949E",       // carbon text_dim
    border: "#535558",       // carbon border — visible against dark bg
    borderFocused: "#6A6D72",// carbon border_focused
    accent: "#3FB950",       // carbon success green
    warning: "#D29922",      // carbon warning amber
    error: "#F85149",        // carbon error red
    activeBg: "#17202A",     // carbon selection
    success: "#3FB950",      // carbon success
    bg: "#0B0D10",           // carbon background
    bgPanel: "#161B22",      // slightly lighter than bg for panels
    bgSelected: "#1F2937",   // selection blue-gray
  },
};

// Photon — aligned with Rust LightPhoton spec
// Contrast targets: dimmed ≥ 4.5:1 on bg, border visible (≥ 2:1 decorative)
export const LIGHT_THEME: Theme = {
  name: "light",
  colors: {
    primary: "#0969DA",      // photon info blue
    secondary: "#6E59CB",    // photon keyword purple
    text: "#1F2328",         // photon foreground
    dimmed: "#57606A",       // photon text_dim — darkened for ≥ 4.5:1 contrast
    border: "#B8C0C8",       // photon border — darkened so lines are visible
    borderFocused: "#8B949E",// photon border_focused
    accent: "#1A7F37",       // photon success
    warning: "#9A6700",      // photon warning
    error: "#CF222E",        // photon error
    activeBg: "#EAF2FF",     // photon selection
    success: "#1A7F37",      // photon success
    bg: "#FAFAFA",           // photon background
    bgPanel: "#F0F4F8",      // slightly tinted panel bg
    bgSelected: "#DDF4FF",   // light blue selection
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
  initialTheme?: ThemeName;
  onThemeChange?: (name: ThemeName) => void;
}

export function ThemeProvider({ children, initialTheme, onThemeChange }: ThemeProviderProps) {
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme ?? "light");

  const toggleTheme = useCallback(() => {
    setThemeName((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      onThemeChange?.(next);
      return next;
    });
  }, [onThemeChange]);

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
