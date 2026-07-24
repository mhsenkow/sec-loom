import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ThemeContext, themes } from "../theme";
import type { ThemeId } from "../types";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(() => {
    const stored = localStorage.getItem("sec-loom-theme") as ThemeId | null;
    if (stored && themes.some((item) => item.id === stored)) return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "solar-bloom" : "night-grid";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("sec-loom-theme", theme);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, setTheme, mode: themes.find((item) => item.id === theme)?.mode ?? "dark" }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
