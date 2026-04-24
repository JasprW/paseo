import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<(_: string) => Promise<string | null>>(),
  setItem: vi.fn<(_: string, __: string) => Promise<void>>(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorageMock,
}));

describe("use-settings", () => {
  beforeEach(() => {
    vi.resetModules();
    asyncStorageMock.getItem.mockReset();
    asyncStorageMock.setItem.mockReset();
  });

  it("defaults built-in daemon management to enabled when storage is empty", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue();

    const mod = await import("./use-settings");
    const result = await mod.loadSettingsFromStorage();

    expect(result).toEqual(mod.DEFAULT_APP_SETTINGS);
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      mod.APP_SETTINGS_KEY,
      JSON.stringify(mod.DEFAULT_APP_SETTINGS),
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

  it("loads persisted built-in daemon management state", async () => {
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
      manageBuiltInDaemon: false,
      sendBehavior: "interrupt",
      releaseChannel: "stable",
    });
    expect(asyncStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("loads persisted beta release channel", async () => {
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

    expect(result.releaseChannel).toBe("beta");
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
      manageBuiltInDaemon: false,
      sendBehavior: "interrupt",
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
      manageBuiltInDaemon: true,
      sendBehavior: "interrupt",
      releaseChannel: "beta",
    });
  });
});
