import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
const APP_SETTINGS_QUERY_KEY = ["app-settings"];

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";

const VALID_THEME_MODES = new Set<string>(["system", "light", "dark"]);
const VALID_LIGHT_THEMES = new Set<string>(LIGHT_THEME_NAMES);
const VALID_DARK_THEMES = new Set<string>(DARK_THEME_NAMES);
const VALID_LEGACY_THEMES = new Set<string>([...LIGHT_THEME_NAMES, ...DARK_THEME_NAMES, "auto"]);
const VALID_SEND_BEHAVIORS = new Set<string>(["interrupt", "queue"]);
const VALID_RELEASE_CHANNELS = new Set<string>(["stable", "beta"]);

export interface AppSettings {
  themeMode: ThemeMode;
  lightTheme: LightThemeName;
  darkTheme: DarkThemeName;
  uiFont: string;
  bodyFont: string;
  monoFont: string;
  manageBuiltInDaemon: boolean;
  sendBehavior: SendBehavior;
  releaseChannel: ReleaseChannel;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  themeMode: "system",
  lightTheme: "light",
  darkTheme: "dark",
  uiFont: DEFAULT_UI_FONT_FAMILY,
  bodyFont: DEFAULT_BODY_FONT_FAMILY,
  monoFont: DEFAULT_MONO_FONT_FAMILY,
  manageBuiltInDaemon: true,
  sendBehavior: "interrupt",
  releaseChannel: "stable",
};

export interface UseAppSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: unknown | null;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export function useAppSettings(): UseAppSettingsReturn {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: loadSettingsFromStorage,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      try {
        const prev =
          queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ?? DEFAULT_APP_SETTINGS;
        const next = normalizeAppSettings({ ...prev, ...updates });
        queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
        await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      } catch (err) {
        console.error("[AppSettings] Failed to save settings:", err);
        throw err;
      }
    },
    [queryClient],
  );

  const resetSettings = useCallback(async () => {
    try {
      const next = { ...DEFAULT_APP_SETTINGS };
      queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[AppSettings] Failed to reset settings:", err);
      throw err;
    }
  }, [queryClient]);

  return {
    settings: data ?? DEFAULT_APP_SETTINGS,
    isLoading: isPending,
    error: error ?? null,
    updateSettings,
    resetSettings,
  };
}

export async function loadSettingsFromStorage(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(APP_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      return {
        ...DEFAULT_APP_SETTINGS,
        ...pickAppSettingsFromStored(parsed),
      };
    }

    const legacyStored = await AsyncStorage.getItem(LEGACY_SETTINGS_KEY);
    if (legacyStored) {
      const legacyParsed = JSON.parse(legacyStored) as Record<string, unknown>;
      const next = {
        ...DEFAULT_APP_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyParsed),
      } satisfies AppSettings;
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_APP_SETTINGS));
    return DEFAULT_APP_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

function pickAppSettingsFromLegacy(legacy: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (typeof legacy.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = legacy.manageBuiltInDaemon;
  }
  if (legacy.releaseChannel === "stable" || legacy.releaseChannel === "beta") {
    result.releaseChannel = legacy.releaseChannel;
  }
  return {
    ...result,
    ...pickThemeSettingsFromStored(legacy),
  };
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    uiFont: normalizeUiFontFamily(settings.uiFont),
    bodyFont: normalizeBodyFontFamily(settings.bodyFont),
    monoFont: normalizeMonoFontFamily(settings.monoFont),
  };
}

function pickAppSettingsFromStored(stored: Record<string, unknown>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {
    ...pickThemeSettingsFromStored(stored),
  };
  if (typeof stored.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (isSendBehavior(stored.sendBehavior)) {
    result.sendBehavior = stored.sendBehavior;
  }
  if (isReleaseChannel(stored.releaseChannel)) {
    result.releaseChannel = stored.releaseChannel;
  }
  result.uiFont = normalizeUiFontFamily(stored.uiFont);
  result.bodyFont = normalizeBodyFontFamily(stored.bodyFont);
  result.monoFont = normalizeMonoFontFamily(stored.monoFont);
  return result;
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

export const useSettings = useAppSettings;
