import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryClient as appQueryClient } from "@/query/query-client";
import {
  DEFAULT_DESKTOP_SETTINGS,
  loadDesktopSettings,
  migrateLegacyDesktopSettings,
  useDesktopSettings,
} from "@/desktop/settings/desktop-settings";
import { isElectronRuntime } from "@/desktop/host";
import {
  DARK_THEME_NAMES,
  LIGHT_THEME_NAMES,
  getThemeColorScheme,
  type DarkThemeName,
  type LightThemeName,
  type ThemeMode,
  type ThemeName,
} from "@/styles/theme";
import {
  DEFAULT_BODY_FONT_FAMILY,
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  normalizeBodyFontFamily,
  normalizeMonoFontFamily,
  normalizeUiFontFamily,
} from "@/styles/font-options";

export const APP_SETTINGS_KEY = "@paseo:app-settings";
const LEGACY_SETTINGS_KEY = "@paseo:settings";
const APP_SETTINGS_QUERY_KEY = ["app-settings"] as const;
export const DEFAULT_CHAT_LINE_HEIGHT_MULTIPLIER = 1;
export const MIN_CHAT_LINE_HEIGHT_MULTIPLIER = 0.8;
export const MAX_CHAT_LINE_HEIGHT_MULTIPLIER = 1.6;

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";

export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
const VALID_THEME_MODES = new Set<string>(["system", "light", "dark"]);
const VALID_LIGHT_THEMES = new Set<string>(LIGHT_THEME_NAMES);
const VALID_DARK_THEMES = new Set<string>(DARK_THEME_NAMES);
const VALID_LEGACY_THEMES = new Set<string>([...LIGHT_THEME_NAMES, ...DARK_THEME_NAMES, "auto"]);
const VALID_SEND_BEHAVIORS = new Set<string>(["interrupt", "queue"]);
const VALID_RELEASE_CHANNELS = new Set<string>(["stable", "beta"]);
const VALID_SERVICE_URL_BEHAVIORS = new Set<string>(["ask", "in-app", "external"]);

export interface AppSettings {
  themeMode: ThemeMode;
  lightTheme: LightThemeName;
  darkTheme: DarkThemeName;
  uiFont: string;
  bodyFont: string;
  monoFont: string;
  chatLineHeightMultiplier: number;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
}

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  themeMode: "system",
  lightTheme: "light",
  darkTheme: "dark",
  uiFont: DEFAULT_UI_FONT_FAMILY,
  bodyFont: DEFAULT_BODY_FONT_FAMILY,
  monoFont: DEFAULT_MONO_FONT_FAMILY,
  chatLineHeightMultiplier: DEFAULT_CHAT_LINE_HEIGHT_MULTIPLIER,
  sendBehavior: "interrupt",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
};

export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

export interface UseAppSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export interface UseSettingsReturn {
  settings: Settings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export function useAppSettings(): UseAppSettingsReturn {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: loadAppSettingsFromStorage,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      try {
        await saveAppSettings({ queryClient, updates });
      } catch (err) {
        console.error("[AppSettings] Failed to save settings:", err);
        throw err;
      }
    },
    [queryClient],
  );

  const resetSettings = useCallback(async () => {
    try {
      const next = { ...DEFAULT_CLIENT_SETTINGS };
      queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[AppSettings] Failed to reset settings:", err);
      throw err;
    }
  }, [queryClient]);

  return {
    settings: data ?? DEFAULT_CLIENT_SETTINGS,
    isLoading: isPending,
    error: error ?? null,
    updateSettings,
    resetSettings,
  };
}

export function useSettings(): UseSettingsReturn {
  const appSettings = useAppSettings();
  const desktopSettings = useDesktopSettings();

  const updateSettings = useCallback(
    async (updates: Partial<Settings>) => {
      const appUpdates: Partial<AppSettings> = {};
      if (updates.themeMode !== undefined) {
        appUpdates.themeMode = updates.themeMode;
      }
      if (updates.lightTheme !== undefined) {
        appUpdates.lightTheme = updates.lightTheme;
      }
      if (updates.darkTheme !== undefined) {
        appUpdates.darkTheme = updates.darkTheme;
      }
      if (updates.uiFont !== undefined) {
        appUpdates.uiFont = updates.uiFont;
      }
      if (updates.bodyFont !== undefined) {
        appUpdates.bodyFont = updates.bodyFont;
      }
      if (updates.monoFont !== undefined) {
        appUpdates.monoFont = updates.monoFont;
      }
      if (updates.chatLineHeightMultiplier !== undefined) {
        appUpdates.chatLineHeightMultiplier = updates.chatLineHeightMultiplier;
      }
      if (updates.sendBehavior !== undefined) {
        appUpdates.sendBehavior = updates.sendBehavior;
      }
      if (updates.serviceUrlBehavior !== undefined) {
        appUpdates.serviceUrlBehavior = updates.serviceUrlBehavior;
      }
      if (updates.terminalScrollbackLines !== undefined) {
        appUpdates.terminalScrollbackLines = updates.terminalScrollbackLines;
      }
      const promises: Promise<void>[] = [];
      if (Object.keys(appUpdates).length > 0) {
        promises.push(appSettings.updateSettings(appUpdates));
      }

      if (isElectronRuntime()) {
        const desktopUpdates: Parameters<typeof desktopSettings.updateSettings>[0] = {};
        if (updates.manageBuiltInDaemon !== undefined) {
          desktopUpdates.daemon = {
            manageBuiltInDaemon: updates.manageBuiltInDaemon,
          };
        }
        if (updates.releaseChannel !== undefined) {
          desktopUpdates.releaseChannel = updates.releaseChannel;
        }
        if (Object.keys(desktopUpdates).length > 0) {
          promises.push(desktopSettings.updateSettings(desktopUpdates));
        }
      }

      await Promise.all(promises);
    },
    [appSettings, desktopSettings],
  );

  const resetSettings = useCallback(async () => {
    const resets: Promise<void>[] = [appSettings.resetSettings()];
    if (isElectronRuntime()) {
      resets.push(desktopSettings.updateSettings(DEFAULT_DESKTOP_SETTINGS));
    }
    await Promise.all(resets);
  }, [appSettings, desktopSettings]);

  return {
    settings: {
      ...DEFAULT_APP_SETTINGS,
      ...appSettings.settings,
      manageBuiltInDaemon: desktopSettings.settings.daemon.manageBuiltInDaemon,
      releaseChannel: desktopSettings.settings.releaseChannel,
    },
    isLoading: appSettings.isLoading || desktopSettings.isLoading,
    error: appSettings.error ?? desktopSettings.error,
    updateSettings,
    resetSettings,
  };
}

export async function persistAppSettings(updates: Partial<AppSettings>): Promise<void> {
  await saveAppSettings({ queryClient: appQueryClient, updates });
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
}): Promise<void> {
  const current =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage());
  const next = normalizeAppSettings({
    ...DEFAULT_CLIENT_SETTINGS,
    ...current,
    ...input.updates,
  });
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
}

export async function loadAppSettingsFromStorage(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(APP_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      return normalizeAppSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromStored(parsed),
      });
    }

    const legacyStored = await AsyncStorage.getItem(LEGACY_SETTINGS_KEY);
    if (legacyStored) {
      const legacyParsed = JSON.parse(legacyStored) as Record<string, unknown>;
      const next = normalizeAppSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyParsed),
      });
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
    return DEFAULT_CLIENT_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

export async function loadSettingsFromStorage(): Promise<Settings> {
  const legacyDesktopSettings = isElectronRuntime()
    ? await loadLegacyDesktopSettingsFromStorage()
    : null;
  const appSettings = await loadAppSettingsFromStorage();

  if (!isElectronRuntime()) {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...appSettings,
    };
  }

  if (legacyDesktopSettings) {
    await migrateLegacyDesktopSettings(legacyDesktopSettings);
  }

  const desktopSettings = await loadDesktopSettings();
  return {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings,
    manageBuiltInDaemon: desktopSettings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.releaseChannel,
  };
}

function pickAppSettingsFromLegacy(legacy: Record<string, unknown>): Partial<AppSettings> {
  return pickAppSettingsFromStored(legacy);
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    uiFont: normalizeUiFontFamily(settings.uiFont),
    bodyFont: normalizeBodyFontFamily(settings.bodyFont),
    monoFont: normalizeMonoFontFamily(settings.monoFont),
    chatLineHeightMultiplier: normalizeChatLineHeightMultiplier(settings.chatLineHeightMultiplier),
    terminalScrollbackLines:
      parseTerminalScrollbackLines(settings.terminalScrollbackLines) ??
      DEFAULT_TERMINAL_SCROLLBACK_LINES,
  };
}

function pickAppSettingsFromStored(stored: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {
    ...pickThemeSettingsFromStored(stored),
  };
  if (isSendBehavior(stored.sendBehavior)) {
    result.sendBehavior = stored.sendBehavior;
  }
  if (isServiceUrlBehavior(stored.serviceUrlBehavior)) {
    result.serviceUrlBehavior = stored.serviceUrlBehavior;
  }
  const terminalScrollbackLines = parseTerminalScrollbackLines(stored.terminalScrollbackLines);
  if (terminalScrollbackLines !== null) {
    result.terminalScrollbackLines = terminalScrollbackLines;
  }
  result.uiFont = normalizeUiFontFamily(stored.uiFont);
  result.bodyFont = normalizeBodyFontFamily(stored.bodyFont);
  result.monoFont = normalizeMonoFontFamily(stored.monoFont);
  result.chatLineHeightMultiplier = normalizeChatLineHeightMultiplier(
    stored.chatLineHeightMultiplier,
  );
  return result;
}

export function normalizeChatLineHeightMultiplier(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_CHAT_LINE_HEIGHT_MULTIPLIER;
  }
  const clamped = Math.min(
    MAX_CHAT_LINE_HEIGHT_MULTIPLIER,
    Math.max(MIN_CHAT_LINE_HEIGHT_MULTIPLIER, parsed),
  );
  return Math.round(clamped * 10) / 10;
}

function pickThemeSettingsFromStored(stored: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const legacyTheme = readLegacyTheme(stored.theme);
  const legacyConcreteTheme = legacyTheme === "auto" ? null : legacyTheme;

  if (isThemeMode(stored.themeMode)) {
    result.themeMode = stored.themeMode;
  } else if (legacyConcreteTheme) {
    result.themeMode = getThemeColorScheme(legacyConcreteTheme);
  } else if (legacyTheme === "auto") {
    result.themeMode = "system";
  }

  if (isLightThemeName(stored.lightTheme)) {
    result.lightTheme = stored.lightTheme;
  } else if (isLightThemeName(legacyConcreteTheme)) {
    result.lightTheme = legacyConcreteTheme;
  }

  if (isDarkThemeName(stored.darkTheme)) {
    result.darkTheme = stored.darkTheme;
  } else if (isDarkThemeName(legacyConcreteTheme)) {
    result.darkTheme = legacyConcreteTheme;
  }

  return result;
}

export function parseTerminalScrollbackLines(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numericValue)),
  );
}

async function loadLegacyDesktopSettingsFromStorage(): Promise<{
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
} | null> {
  const stored = await loadRendererSettingsPayload();
  if (!stored) {
    return null;
  }

  const result: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  } = {};

  if (typeof stored.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (isReleaseChannel(stored.releaseChannel)) {
    result.releaseChannel = stored.releaseChannel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function loadRendererSettingsPayload(): Promise<Record<string, unknown> | null> {
  const current = await AsyncStorage.getItem(APP_SETTINGS_KEY);
  if (current) {
    return JSON.parse(current) as Record<string, unknown>;
  }

  const legacy = await AsyncStorage.getItem(LEGACY_SETTINGS_KEY);
  if (!legacy) {
    return null;
  }
  return JSON.parse(legacy) as Record<string, unknown>;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && VALID_THEME_MODES.has(value);
}

function isLightThemeName(value: unknown): value is LightThemeName {
  return typeof value === "string" && VALID_LIGHT_THEMES.has(value);
}

function isDarkThemeName(value: unknown): value is DarkThemeName {
  return typeof value === "string" && VALID_DARK_THEMES.has(value);
}

function readLegacyTheme(value: unknown): ThemeName | "auto" | null {
  if (typeof value === "string" && VALID_LEGACY_THEMES.has(value)) {
    return value as ThemeName | "auto";
  }
  return null;
}

function isSendBehavior(value: unknown): value is SendBehavior {
  return typeof value === "string" && VALID_SEND_BEHAVIORS.has(value);
}

function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return typeof value === "string" && VALID_RELEASE_CHANNELS.has(value);
}

function isServiceUrlBehavior(value: unknown): value is ServiceUrlBehavior {
  return typeof value === "string" && VALID_SERVICE_URL_BEHAVIORS.has(value);
}
