"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

const THEME_KEY = "bikeops_theme_preference";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  themeMode: "system",
  setThemeMode: () => {},
});

function getSystemDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return getSystemDark();
}

function getDefaultThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const hostname = window.location.hostname.toLowerCase();
  if (
    hostname === "app.bikeops.co" ||
    hostname === "app.localhost" ||
    hostname === "app.lvh.me"
  ) {
    return "light";
  }
  return "system";
}

function applyDarkClass(isDark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const mode =
      stored === "dark" || stored === "light" || stored === "system"
        ? stored
        : getDefaultThemeMode();
    setThemeModeState(mode);
    const dark = resolveIsDark(mode);
    setIsDark(dark);
    applyDarkClass(dark);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (themeMode === "system") {
        const dark = mq.matches;
        setIsDark(dark);
        applyDarkClass(dark);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode, mounted]);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      localStorage.setItem(THEME_KEY, mode);
      const dark = resolveIsDark(mode);
      setIsDark(dark);
      applyDarkClass(dark);
    },
    [],
  );

  return (
    <ThemeContext.Provider value={{ isDark, themeMode, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
