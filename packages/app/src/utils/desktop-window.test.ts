import { describe, expect, it } from "vitest";
import { resolveWindowControlsPadding } from "@/utils/desktop-window";

const rawPadding = {
  left: 80,
  right: 48,
  top: 28,
};

describe("resolveWindowControlsPadding", () => {
  it("pads the main header for window controls when the app sidebar is closed", () => {
    expect(
      resolveWindowControlsPadding({
        role: "header",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
        isCompactLayout: false,
      }),
    ).toEqual({
      left: 80,
      right: 48,
      top: 0,
    });
  });

  it("does not add left padding to detail headers with their own sidebar", () => {
    expect(
      resolveWindowControlsPadding({
        role: "detailHeader",
        rawPadding,
        sidebarClosed: true,
        explorerOpen: false,
        focusModeEnabled: false,
        isCompactLayout: false,
      }),
    ).toEqual({
      left: 0,
      right: 48,
      top: 0,
    });
  });

  it("pads the compact main header even when desktop sidebars are still marked open", () => {
    expect(
      resolveWindowControlsPadding({
        role: "header",
        rawPadding,
        sidebarClosed: false,
        explorerOpen: true,
        focusModeEnabled: false,
        isCompactLayout: true,
      }),
    ).toEqual({
      left: 80,
      right: 48,
      top: 0,
    });
  });
});
