/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  applyWebFontOverrides,
  buildWebFontOverrideCss,
  collectReactNativeWebDefaultFontSelectors,
  isReactNativeWebDefaultFontFamily,
} from "./web-font-overrides";

describe("web font overrides", () => {
  it("recognizes React Native Web's default body font family", () => {
    expect(
      isReactNativeWebDefaultFontFamily(
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      ),
    ).toBe(true);
    expect(isReactNativeWebDefaultFontFamily("SFMono-Regular, Menlo, monospace")).toBe(false);
  });

  it("collects only React Native Web default font-family selectors", () => {
    const selectors = collectReactNativeWebDefaultFontSelectors([
      {
        selectorText: ".css-text-146c3p1",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      },
      {
        selectorText: ".r-fontFamily-1qd0xha",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      },
      {
        selectorText: ".r-fontFamily-x11e5r",
        fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      },
    ]);

    expect(selectors).toEqual([".css-text-146c3p1", ".r-fontFamily-1qd0xha"]);
  });

  it("builds targeted font overrides while preserving explicit mono font classes", () => {
    const css = buildWebFontOverrideCss({
      defaultFontSelectors: [".css-text-146c3p1", ".r-fontFamily-1qd0xha"],
      customFontRules: [
        {
          selectorText: ".r-fontFamily-x11e5r",
          fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        },
      ],
    });

    expect(css).toContain(".css-text-146c3p1");
    expect(css).toContain(".r-fontFamily-1qd0xha");
    expect(css).toContain("font-family: var(--paseo-font-ui);");
    expect(css).not.toContain("font-family: var(--paseo-font-body);");
    expect(css).toContain("font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;");
    expect(css.indexOf(".css-text-146c3p1")).toBeLessThan(css.indexOf(".r-fontFamily-x11e5r"));
    expect(css).not.toContain('[class*="r-fontFamily-"]');
  });

  it("updates Unistyles font-family variables used by generated text classes", () => {
    const document = window.document.implementation.createHTMLDocument("fonts");

    applyWebFontOverrides(document, {
      ui: "System UI",
      body: "Source Han Serif SC",
      mono: "Berkeley Mono",
    });

    const rootStyle = document.documentElement.style;
    expect(rootStyle.getPropertyValue("--fontFamily-ui")).toBe("System UI");
    expect(rootStyle.getPropertyValue("--fontFamily-body")).toBe("Source Han Serif SC");
    expect(rootStyle.getPropertyValue("--fontFamily-mono")).toBe("Berkeley Mono");
  });

  it("refreshes overrides when Unistyles font rules are inserted after initial application", async () => {
    const document = window.document;
    document.head.innerHTML = "";
    document.body.innerHTML = "";

    applyWebFontOverrides(document, {
      ui: "System UI",
      body: "Source Han Serif SC",
      mono: "Berkeley Mono",
    });

    const style = document.createElement("style");
    style.textContent = ".lateBodyFont { font-family: Source Han Serif SC; }";
    document.head.appendChild(style);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const overrideCss = document.getElementById("paseo-web-font-overrides")?.textContent ?? "";
    expect(overrideCss).toContain(".lateBodyFont");
    expect(overrideCss.indexOf(".r-fontFamily-1qd0xha")).toBeLessThan(
      overrideCss.indexOf(".lateBodyFont"),
    );
  });
});
