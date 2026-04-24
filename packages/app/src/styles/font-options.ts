import { Fonts } from "@/constants/theme";

export interface AppFontFamilies {
  ui: string;
  body: string;
  mono: string;
}

export const DEFAULT_BODY_FONT_FAMILY = Fonts.sans;
export const DEFAULT_UI_FONT_FAMILY = DEFAULT_BODY_FONT_FAMILY;
export const DEFAULT_MONO_FONT_FAMILY = [
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono NF",
  "MesloLGM Nerd Font",
  "MesloLGM NF",
  "Hack Nerd Font",
  "FiraCode Nerd Font",
  "Symbols Nerd Font",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "'Liberation Mono'",
  "monospace",
].join(", ");

const MAX_FONT_FAMILY_LENGTH = 240;
const LEGACY_BODY_FONT_FAMILIES = new Map<string, string>([
  ["system", DEFAULT_BODY_FONT_FAMILY],
  ["serif", Fonts.serif],
  ["rounded", Fonts.rounded],
]);
const LEGACY_MONO_FONT_FAMILIES = new Map<string, string>([
  ["developer", DEFAULT_MONO_FONT_FAMILY],
  ["system", Fonts.mono],
  ["jetbrains", "'JetBrains Mono', 'JetBrainsMono Nerd Font', 'SF Mono', Menlo, monospace"],
  ["fira-code", "'Fira Code', 'FiraCode Nerd Font', 'SF Mono', Menlo, monospace"],
  ["menlo", "Menlo, Monaco, Consolas, monospace"],
]);

export const DEFAULT_APP_FONT_FAMILIES: AppFontFamilies = {
  ui: DEFAULT_UI_FONT_FAMILY,
  body: DEFAULT_BODY_FONT_FAMILY,
  mono: DEFAULT_MONO_FONT_FAMILY,
};

export function sanitizeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_FONT_FAMILY_LENGTH ||
    containsControlCharacter(trimmed)
  ) {
    return fallback;
  }

  return trimmed;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode < 32 || charCode === 127) {
      return true;
    }
  }
  return false;
}

export function normalizeBodyFontFamily(value: unknown): string {
  const fontFamily = sanitizeFontFamily(value, DEFAULT_APP_FONT_FAMILIES.body);
  return LEGACY_BODY_FONT_FAMILIES.get(fontFamily) ?? fontFamily;
}

export function normalizeUiFontFamily(value: unknown): string {
  const fontFamily = sanitizeFontFamily(value, DEFAULT_APP_FONT_FAMILIES.ui);
  return LEGACY_BODY_FONT_FAMILIES.get(fontFamily) ?? fontFamily;
}

export function normalizeMonoFontFamily(value: unknown): string {
  const fontFamily = sanitizeFontFamily(value, DEFAULT_APP_FONT_FAMILIES.mono);
  return LEGACY_MONO_FONT_FAMILIES.get(fontFamily) ?? fontFamily;
}

export function resolveAppFontFamilies(input: {
  uiFont: string;
  bodyFont: string;
  monoFont: string;
}): AppFontFamilies {
  return {
    ui: normalizeUiFontFamily(input.uiFont),
    body: normalizeBodyFontFamily(input.bodyFont),
    mono: normalizeMonoFontFamily(input.monoFont),
  };
}
