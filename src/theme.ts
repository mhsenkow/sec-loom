import { createContext, useContext } from "react";
import type { ThemeId } from "./types";

export const themes: Array<{ id: ThemeId; name: string; mode: "dark" | "light"; swatch: string }> = [
  { id: "night-grid", name: "Night Grid", mode: "dark", swatch: "#c9ff46" },
  { id: "blacksite", name: "Blacksite", mode: "dark", swatch: "#ff6b35" },
  { id: "solar-bloom", name: "Solar Bloom", mode: "light", swatch: "#178f4b" },
  { id: "paper-terminal", name: "Paper Terminal", mode: "light", swatch: "#a84213" },
];

export interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  mode: "dark" | "light";
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
