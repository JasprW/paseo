/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
}));

import {
  beginWebResizeSelectionLock,
  endWebResizeSelectionLock,
} from "./web-resize-selection-lock";

describe("web resize selection lock", () => {
  beforeEach(() => {
    document.body.style.cursor = "default";
  });

  afterEach(() => {
    endWebResizeSelectionLock();
    endWebResizeSelectionLock();
    document.documentElement.removeAttribute("data-paseo-resize-selection-lock");
    document.body.style.cursor = "";
  });

  it("disables document text selection while a resize drag is active", () => {
    beginWebResizeSelectionLock("col-resize");

    expect(document.documentElement.getAttribute("data-paseo-resize-selection-lock")).toBe("true");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.getElementById("paseo-resize-selection-lock-style")?.textContent).toContain(
      "user-select: none !important",
    );

    endWebResizeSelectionLock();

    expect(document.documentElement.hasAttribute("data-paseo-resize-selection-lock")).toBe(false);
    expect(document.body.style.cursor).toBe("default");
  });

  it("keeps selection disabled until nested resize locks are released", () => {
    beginWebResizeSelectionLock("col-resize");
    beginWebResizeSelectionLock("row-resize");

    endWebResizeSelectionLock();

    expect(document.documentElement.getAttribute("data-paseo-resize-selection-lock")).toBe("true");
    expect(document.body.style.cursor).toBe("row-resize");

    endWebResizeSelectionLock();

    expect(document.documentElement.hasAttribute("data-paseo-resize-selection-lock")).toBe(false);
    expect(document.body.style.cursor).toBe("default");
  });
});
