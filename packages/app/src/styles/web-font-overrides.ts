import type { AppFontFamilies } from "./font-options";

const STYLE_ELEMENT_ID = "paseo-web-font-overrides";
const REACT_NATIVE_WEB_DEFAULT_BODY_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const FALLBACK_REACT_NATIVE_WEB_DEFAULT_FONT_SELECTOR = ".r-fontFamily-1qd0xha";
const overrideObserverStates = new WeakMap<Document, { pendingRefresh: boolean }>();

export interface FontRuleLike {
  selectorText: string;
  fontFamily: string;
}

function normalizeFontFamily(value: string): string {
  return value.replaceAll("'", '"').replace(/\s+/g, " ").trim().toLowerCase();
}

export function isReactNativeWebDefaultFontFamily(fontFamily: string): boolean {
  return (
    normalizeFontFamily(fontFamily) === normalizeFontFamily(REACT_NATIVE_WEB_DEFAULT_BODY_FONT)
  );
}

export function collectReactNativeWebDefaultFontSelectors(rules: Iterable<FontRuleLike>): string[] {
  const selectors = new Set<string>();
  for (const rule of rules) {
    if (!isReactNativeWebDefaultFontFamily(rule.fontFamily)) {
      continue;
    }
    selectors.add(rule.selectorText);
  }
  return [...selectors];
}

function collectCustomFontRules(rules: Iterable<FontRuleLike>): FontRuleLike[] {
  const seen = new Set<string>();
  const customRules: FontRuleLike[] = [];
  for (const rule of rules) {
    if (isReactNativeWebDefaultFontFamily(rule.fontFamily)) {
      continue;
    }
    const key = `${rule.selectorText}\n${rule.fontFamily}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    customRules.push(rule);
  }
  return customRules;
}

export function buildWebFontOverrideCss(input: {
  defaultFontSelectors: string[];
  customFontRules?: FontRuleLike[];
}): string {
  const selectors = new Set<string>([
    "html",
    "body",
    "#root",
    FALLBACK_REACT_NATIVE_WEB_DEFAULT_FONT_SELECTOR,
    ...input.defaultFontSelectors,
  ]);
  const uiOverride = `${[...selectors].join(",\n")} {\n  font-family: var(--paseo-font-ui);\n}\n`;
  const customOverrides = (input.customFontRules ?? [])
    .map((rule) => `${rule.selectorText} {\n  font-family: ${rule.fontFamily};\n}`)
    .join("\n");

  return customOverrides ? `${uiOverride}\n${customOverrides}\n` : uiOverride;
}

function getOrCreateStyleElement(document: Document): HTMLStyleElement {
  let styleElement = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleElement);
  }
  return styleElement;
}

function collectDocumentFontRules(document: Document): FontRuleLike[] {
  const rules: FontRuleLike[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const ownerNode = "ownerNode" in sheet ? (sheet.ownerNode as Element | null | undefined) : null;
    if (ownerNode?.id === STYLE_ELEMENT_ID) {
      continue;
    }

    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }

    for (const rule of Array.from(cssRules)) {
      if (!(rule instanceof CSSStyleRule)) {
        continue;
      }
      const fontFamily = rule.style.fontFamily || rule.style.getPropertyValue("font-family");
      if (!fontFamily) {
        continue;
      }
      rules.push({
        selectorText: rule.selectorText,
        fontFamily,
      });
    }
  }
  return rules;
}

export function applyWebFontOverrides(document: Document, fontFamilies: AppFontFamilies): void {
  document.documentElement.style.setProperty("--paseo-font-ui", fontFamilies.ui);
  document.documentElement.style.setProperty("--paseo-font-body", fontFamilies.body);
  document.documentElement.style.setProperty("--paseo-font-mono", fontFamilies.mono);
  document.documentElement.style.setProperty("--fontFamily-ui", fontFamilies.ui);
  document.documentElement.style.setProperty("--fontFamily-body", fontFamilies.body);
  document.documentElement.style.setProperty("--fontFamily-mono", fontFamilies.mono);
  document.body.style.fontFamily = fontFamilies.ui;

  refreshWebFontOverrideCss(document);
  ensureWebFontOverrideObserver(document);
  scheduleWebFontOverrideRefresh(document);
}

function refreshWebFontOverrideCss(document: Document): void {
  const styleElement = getOrCreateStyleElement(document);
  const fontRules = collectDocumentFontRules(document);
  const defaultFontSelectors = collectReactNativeWebDefaultFontSelectors(fontRules);
  const nextCss = buildWebFontOverrideCss({
    defaultFontSelectors,
    customFontRules: collectCustomFontRules(fontRules),
  });
  if (styleElement.textContent !== nextCss) {
    styleElement.textContent = nextCss;
  }
}

function ensureWebFontOverrideObserver(document: Document): void {
  if (overrideObserverStates.has(document)) {
    return;
  }

  const MutationObserverCtor =
    document.defaultView?.MutationObserver ??
    (globalThis as typeof globalThis & { MutationObserver?: typeof MutationObserver })
      .MutationObserver;
  if (!MutationObserverCtor) {
    return;
  }

  const state = { pendingRefresh: false };
  overrideObserverStates.set(document, state);
  const observer = new MutationObserverCtor((mutations) => {
    const styleElement = document.getElementById(STYLE_ELEMENT_ID);
    const onlyTouchedOverrideStyle =
      Boolean(styleElement) &&
      mutations.every(
        (mutation) =>
          mutation.target === styleElement || styleElement?.contains(mutation.target as Node),
      );
    if (onlyTouchedOverrideStyle) {
      return;
    }
    scheduleWebFontOverrideRefresh(document);
  });
  observer.observe(document.head, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

function scheduleWebFontOverrideRefresh(document: Document): void {
  const state = overrideObserverStates.get(document);
  if (!state || state.pendingRefresh) {
    return;
  }
  state.pendingRefresh = true;

  const refresh = () => {
    if (!state.pendingRefresh) {
      return;
    }
    state.pendingRefresh = false;
    refreshWebFontOverrideCss(document);
  };
  const requestAnimationFrame = document.defaultView?.requestAnimationFrame;
  if (requestAnimationFrame) {
    requestAnimationFrame(refresh);
  }
  setTimeout(refresh, 0);
}
