import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<(_: string) => Promise<string | null>>(),
  setItem: vi.fn<(_: string, __: string) => Promise<void>>(),
}));

const electronRuntimeState = vi.hoisted(() => ({
  isElectron: false,
}));

const desktopDefaults = vi.hoisted(() => ({
  releaseChannel: "stable",
  daemon: {
    manageBuiltInDaemon: true,
    keepRunningAfterQuit: true,
  },
}));

const desktopSettingsMock = vi.hoisted(() => ({
  loadDesktopSettings: vi.fn<() => Promise<unknown>>(),
  migrateLegacyDesktopSettings: vi.fn<(_: unknown) => Promise<void>>(),
  useDesktopSettings: vi.fn(() => ({
    settings: desktopDefaults,
    isLoading: false,
    error: null,
    updateSettings: vi.fn<(_: unknown) => Promise<void>>(),
  })),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorageMock,
}));

vi.mock("@/desktop/host", () => ({
  isElectronRuntime: () => electronRuntimeState.isElectron,
}));

vi.mock("@/desktop/settings/desktop-settings", () => ({
  DEFAULT_DESKTOP_SETTINGS: desktopDefaults,
  ...desktopSettingsMock,
}));

describe("use-settings", () => {
  beforeEach(() => {
    vi.resetModules();
    asyncStorageMock.getItem.mockReset();
    asyncStorageMock.setItem.mockReset();
    electronRuntimeState.isElectron = false;
    desktopSettingsMock.loadDesktopSettings.mockReset();
    desktopSettingsMock.migrateLegacyDesktopSettings.mockReset();
    desktopSettingsMock.useDesktopSettings.mockClear();
  });

  it("defaults built-in daemon management to enabled when storage is empty", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result).toEqual(mod.DEFAULT_APP_SETTINGS);
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      mod.APP_SETTINGS_KEY,
      JSON.stringify(mod.DEFAULT_CLIENT_SETTINGS),
    );
  });

  it("defaults theme mode and concrete themes when storage is empty", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.themeMode).toBe("system");
    expect(result.lightTheme).toBe("light");
    expect(result.darkTheme).toBe("dark");
  });

  it("defaults UI, session, and mono font selections when storage is empty", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.uiFont).toBe(mod.DEFAULT_APP_SETTINGS.uiFont);
    expect(result.bodyFont).toBe(mod.DEFAULT_APP_SETTINGS.bodyFont);
    expect(result.monoFont).toBe(mod.DEFAULT_APP_SETTINGS.monoFont);
  });

  it("defaults release channel to stable when storage is empty", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.releaseChannel).toBe("stable");
  });

  it("defaults chat line height multiplier to 1.0x when storage is empty", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.chatLineHeightMultiplier).toBe(1);
  });

  it("ignores renderer-owned daemon management state outside Electron", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          themeMode: "dark",
          lightTheme: "light",
          darkTheme: "zinc",
          manageBuiltInDaemon: false,
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result).toEqual({
      themeMode: "dark",
      lightTheme: "light",
      darkTheme: "zinc",
      uiFont: mod.DEFAULT_APP_SETTINGS.uiFont,
      bodyFont: mod.DEFAULT_APP_SETTINGS.bodyFont,
      monoFont: mod.DEFAULT_APP_SETTINGS.monoFont,
      chatLineHeightMultiplier: 1,
      manageBuiltInDaemon: true,
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      releaseChannel: "stable",
    });
  });

  it("ignores renderer-owned release channel outside Electron", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          releaseChannel: "beta",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.releaseChannel).toBe("stable");
  });

  it("keeps legacy AsyncStorage migration for client settings only", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return null;
      }
      if (key === "@paseo:settings") {
        return JSON.stringify({
          theme: "dark",
          manageBuiltInDaemon: false,
          releaseChannel: "beta",
        });
      }
      return null;
    });
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadAppSettingsFromStorage();

    expect(result).toEqual({
      themeMode: "dark",
      lightTheme: "light",
      darkTheme: "dark",
      uiFont: mod.DEFAULT_APP_SETTINGS.uiFont,
      bodyFont: mod.DEFAULT_APP_SETTINGS.bodyFont,
      monoFont: mod.DEFAULT_APP_SETTINGS.monoFont,
      chatLineHeightMultiplier: 1,
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
    });
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      mod.APP_SETTINGS_KEY,
      JSON.stringify(result),
    );
  });

  it("migrates legacy desktop-owned settings through Electron before reading effective settings", async () => {
    electronRuntimeState.isElectron = true;
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          theme: "light",
          manageBuiltInDaemon: false,
          releaseChannel: "beta",
        });
      }
      return null;
    });
    desktopSettingsMock.migrateLegacyDesktopSettings.mockResolvedValue();
    desktopSettingsMock.loadDesktopSettings.mockResolvedValue({
      releaseChannel: "beta",
      daemon: {
        manageBuiltInDaemon: false,
        keepRunningAfterQuit: true,
      },
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(desktopSettingsMock.migrateLegacyDesktopSettings).toHaveBeenCalledWith({
      manageBuiltInDaemon: false,
      releaseChannel: "beta",
    });
    expect(result).toEqual({
      themeMode: "light",
      lightTheme: "light",
      darkTheme: "dark",
      uiFont: mod.DEFAULT_APP_SETTINGS.uiFont,
      bodyFont: mod.DEFAULT_APP_SETTINGS.bodyFont,
      monoFont: mod.DEFAULT_APP_SETTINGS.monoFont,
      chatLineHeightMultiplier: 1,
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      manageBuiltInDaemon: false,
      releaseChannel: "beta",
    });
  });

  it("skips desktop IPC when loading effective settings outside Electron", async () => {
    asyncStorageMock.getItem.mockResolvedValue(
      JSON.stringify({
        theme: "light",
      }),
    );

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result).toEqual({
      themeMode: "light",
      lightTheme: "light",
      darkTheme: "dark",
      uiFont: mod.DEFAULT_APP_SETTINGS.uiFont,
      bodyFont: mod.DEFAULT_APP_SETTINGS.bodyFont,
      monoFont: mod.DEFAULT_APP_SETTINGS.monoFont,
      chatLineHeightMultiplier: 1,
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      manageBuiltInDaemon: true,
      releaseChannel: "stable",
    });
    expect(desktopSettingsMock.loadDesktopSettings).not.toHaveBeenCalled();
  });

  it("loads persisted Claude Light as the selected light theme", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          themeMode: "light",
          lightTheme: "claude-light",
          darkTheme: "claude",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.lightTheme).toBe("claude-light");
    expect(result.darkTheme).toBe("claude");
  });

  it("loads persisted UI, session, and mono font selections independently", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          uiFont: "SF Pro Text",
          bodyFont: "Source Han Serif SC",
          monoFont: "Iosevka Term",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.uiFont).toBe("SF Pro Text");
    expect(result.bodyFont).toBe("Source Han Serif SC");
    expect(result.monoFont).toBe("Iosevka Term");
  });

  it("keeps UI font on the system default when older stored settings only contain session fonts", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          bodyFont: "Source Han Serif SC",
          monoFont: "Iosevka Term",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.uiFont).toBe(mod.DEFAULT_APP_SETTINGS.uiFont);
    expect(result.bodyFont).toBe("Source Han Serif SC");
    expect(result.monoFont).toBe("Iosevka Term");
  });

  it("migrates persisted fixed font option ids to font families", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          uiFont: "serif",
          bodyFont: "rounded",
          monoFont: "jetbrains",
        });
      }
      return null;
    });

    const [mod, fontOptions] = await Promise.all([
      import("./use-settings"),
      import("@/styles/font-options"),
    ]);
    const result = await mod.loadSettingsFromStorage();
    const expected = fontOptions.resolveAppFontFamilies({
      uiFont: "serif",
      bodyFont: "rounded",
      monoFont: "jetbrains",
    });

    expect(result.uiFont).toBe(expected.ui);
    expect(result.bodyFont).toBe(expected.body);
    expect(result.monoFont).toBe(expected.mono);
    expect(result.uiFont).not.toBe("serif");
    expect(result.bodyFont).not.toBe("rounded");
    expect(result.monoFont).not.toBe("jetbrains");
  });

  it("trims persisted UI, session, and mono font families", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          uiFont: "  SF Pro Text  ",
          bodyFont: "  Helvetica Neue  ",
          monoFont: "  Berkeley Mono  ",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.uiFont).toBe("SF Pro Text");
    expect(result.bodyFont).toBe("Helvetica Neue");
    expect(result.monoFont).toBe("Berkeley Mono");
  });

  it("ignores invalid persisted font families", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          uiFont: "Bad\tFont",
          bodyFont: "   ",
          monoFont: "Bad\nFont",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.uiFont).toBe(mod.DEFAULT_APP_SETTINGS.uiFont);
    expect(result.bodyFont).toBe(mod.DEFAULT_APP_SETTINGS.bodyFont);
    expect(result.monoFont).toBe(mod.DEFAULT_APP_SETTINGS.monoFont);
  });

  it("loads persisted chat line height multiplier", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          chatLineHeightMultiplier: 1.3,
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.chatLineHeightMultiplier).toBe(1.3);
  });

  it("clamps and rounds persisted chat line height multiplier", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          chatLineHeightMultiplier: 1.26,
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result.chatLineHeightMultiplier).toBe(1.3);
    expect(mod.normalizeChatLineHeightMultiplier(0.1)).toBe(0.8);
    expect(mod.normalizeChatLineHeightMultiplier(9)).toBe(1.6);
    expect(mod.normalizeChatLineHeightMultiplier("bad")).toBe(1);
  });

  it("migrates a persisted system theme preference from the previous app settings shape", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          theme: "auto",
          manageBuiltInDaemon: false,
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result).toEqual({
      themeMode: "system",
      lightTheme: "light",
      darkTheme: "dark",
      uiFont: mod.DEFAULT_APP_SETTINGS.uiFont,
      bodyFont: mod.DEFAULT_APP_SETTINGS.bodyFont,
      monoFont: mod.DEFAULT_APP_SETTINGS.monoFont,
      chatLineHeightMultiplier: 1,
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      manageBuiltInDaemon: true,
      releaseChannel: "stable",
    });
  });

  it("migrates a persisted dark theme selection from the previous app settings shape", async () => {
    asyncStorageMock.getItem.mockImplementation(async (key: string) => {
      if (key === "@paseo:app-settings") {
        return JSON.stringify({
          theme: "ghostty",
          releaseChannel: "beta",
        });
      }
      return null;
    });

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result).toEqual({
      themeMode: "dark",
      lightTheme: "light",
      darkTheme: "ghostty",
      uiFont: mod.DEFAULT_APP_SETTINGS.uiFont,
      bodyFont: mod.DEFAULT_APP_SETTINGS.bodyFont,
      monoFont: mod.DEFAULT_APP_SETTINGS.monoFont,
      chatLineHeightMultiplier: 1,
      sendBehavior: "interrupt",
      serviceUrlBehavior: "ask",
      terminalScrollbackLines: 10_000,
      manageBuiltInDaemon: true,
      releaseChannel: "stable",
    });
  });

  it("loads configured terminal scrollback lines from app settings", async () => {
    asyncStorageMock.getItem.mockResolvedValue(
      JSON.stringify({
        terminalScrollbackLines: 42_000,
      }),
    );

    const mod = await import("./use-settings");
    const result = await mod.loadAppSettingsFromStorage();

    expect(result.terminalScrollbackLines).toBe(42_000);
  });

  it("saves terminal scrollback through app settings persistence", async () => {
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    asyncStorageMock.getItem.mockResolvedValue(JSON.stringify(mod.DEFAULT_CLIENT_SETTINGS));
    const queryClient = new QueryClient();

    await mod.saveAppSettings({
      queryClient,
      updates: { terminalScrollbackLines: 42_000 },
    });

    expect(asyncStorageMock.setItem).toHaveBeenLastCalledWith(
      mod.APP_SETTINGS_KEY,
      JSON.stringify({
        ...mod.DEFAULT_CLIENT_SETTINGS,
        terminalScrollbackLines: 42_000,
      }),
    );
  });

  it("normalizes terminal scrollback lines from storage", async () => {
    asyncStorageMock.getItem.mockResolvedValue(
      JSON.stringify({
        terminalScrollbackLines: 1_000_000.9,
      }),
    );

    const mod = await import("./use-settings");
    const result = await mod.loadAppSettingsFromStorage();

    expect(result.terminalScrollbackLines).toBe(1_000_000);
    expect(mod.parseTerminalScrollbackLines("-10")).toBe(0);
    expect(mod.parseTerminalScrollbackLines("abc")).toBeNull();
  });
});
