import { describe, expect, it } from "vitest";
import {
  DARK_THEME_NAMES,
  LIGHT_THEME_NAMES,
  THEME_TO_UNISTYLES,
  claudeLightTheme,
  getThemeColorScheme,
  resolveThemeName,
} from "./theme";

describe("theme registry", () => {
  it("classifies built-in themes by light and dark color scheme", () => {
    expect(LIGHT_THEME_NAMES).toEqual(["light", "claude-light"]);
    expect(DARK_THEME_NAMES).toEqual(["dark", "zinc", "midnight", "claude", "ghostty"]);

    expect(getThemeColorScheme("light")).toBe("light");
    expect(getThemeColorScheme("claude-light")).toBe("light");
    expect(getThemeColorScheme("zinc")).toBe("dark");
  });

  it("registers Claude Light as a warm light Unistyles theme", () => {
    expect(THEME_TO_UNISTYLES["claude-light"]).toBe("claudeLight");
    expect(claudeLightTheme.colorScheme).toBe("light");
    expect(claudeLightTheme.colors.surface0).toBe("#fdfcf8");
    expect(claudeLightTheme.colors.surfaceSidebar).toBe("#f7f5ef");
    expect(claudeLightTheme.colors.accent).toBe("#d97757");
  });

  it("resolves the active concrete theme from policy and per-scheme settings", () => {
    const settings = {
      themeMode: "system" as const,
      lightTheme: "claude-light" as const,
      darkTheme: "ghostty" as const,
    };

    expect(resolveThemeName(settings, "light")).toBe("claude-light");
    expect(resolveThemeName(settings, "dark")).toBe("ghostty");
    expect(resolveThemeName({ ...settings, themeMode: "light" }, "dark")).toBe("claude-light");
    expect(resolveThemeName({ ...settings, themeMode: "dark" }, "light")).toBe("ghostty");
  });
});
