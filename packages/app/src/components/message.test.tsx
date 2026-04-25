/**
 * @vitest-environment jsdom
 */
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderWidth: { 1: 1 },
    borderRadius: { sm: 4, md: 6, lg: 8, "2xl": 16, full: 999 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { medium: "500", semibold: "600" },
    fontFamily: {
      body: "Source Han Serif SC",
      mono: "Berkeley Mono",
    },
    iconSize: { xs: 12, sm: 14, md: 18 },
    opacity: { 50: 0.5 },
    colors: {
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      borderAccent: "#666",
      accent: "#0a84ff",
      accentForeground: "#fff",
      destructive: "#ff4444",
      palette: {
        white: "#fff",
        green: { 400: "#30d158" },
        red: { 500: "#ff453a" },
      },
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function" ? (factory as (t: typeof theme) => unknown)(theme) : factory,
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { chatLineHeightMultiplier: 1 } }),
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  Easing: {
    linear: vi.fn(),
  },
  cancelAnimation: vi.fn(),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useSharedValue: (value: unknown) => ({ value }),
  withRepeat: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));

vi.mock("react-native-markdown-display", () => {
  const Markdown = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  return {
    __esModule: true,
    default: Markdown,
    MarkdownIt: vi.fn(() => ({
      linkify: { match: vi.fn(() => null) },
      set: vi.fn(),
      use: vi.fn(),
    })),
  };
});

vi.mock("@react-native-masked-view/masked-view", () => ({
  default: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    Circle: createIcon("Circle"),
    Info: createIcon("Info"),
    CheckCircle: createIcon("CheckCircle"),
    XCircle: createIcon("XCircle"),
    FileText: createIcon("FileText"),
    ChevronRight: createIcon("ChevronRight"),
    ChevronDown: createIcon("ChevronDown"),
    Check: createIcon("Check"),
    CheckSquare: createIcon("CheckSquare"),
    Copy: createIcon("Copy"),
    TriangleAlertIcon: createIcon("TriangleAlertIcon"),
    Scissors: createIcon("Scissors"),
    MicVocal: createIcon("MicVocal"),
  };
});

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(),
}));

vi.mock("react-native-svg", () => {
  const Stub = ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children);
  return {
    __esModule: true,
    default: Stub,
    Defs: Stub,
    LinearGradient: Stub,
    Rect: Stub,
    Stop: Stub,
  };
});

vi.mock("@/styles/markdown-styles", () => ({
  createMarkdownStyles: vi.fn(() => ({})),
}));

vi.mock("@/utils/tool-call-display", () => ({
  buildToolCallDisplayModel: vi.fn(),
}));

vi.mock("@/utils/tool-call-icon", () => ({
  resolveToolCallIcon: vi.fn(() => null),
}));

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("@/utils/scroll-jank", () => ({
  markScrollInvestigationEvent: vi.fn(),
}));

vi.mock("@/utils/assistant-image-metadata", () => ({
  getAssistantImageMetadata: vi.fn(),
  setAssistantImageMetadata: vi.fn(),
}));

vi.mock("@/utils/assistant-message-height-estimate", () => ({
  setAssistantMarkdownBlockHeight: vi.fn(),
}));

vi.mock("@/utils/assistant-image-source", () => ({
  resolveAssistantImageSource: vi.fn(),
}));

vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: vi.fn(() => null),
}));

vi.mock("@/attachments/service", () => ({
  persistAttachmentFromBase64: vi.fn(),
  persistAttachmentFromDataUrl: vi.fn(),
}));

vi.mock("./plan-card", () => ({
  PlanCard: () => null,
}));

vi.mock("./tool-call-sheet", () => ({
  useToolCallSheet: () => ({ openToolCallSheet: vi.fn() }),
}));

vi.mock("./tool-call-details", () => ({
  ToolCallDetailsContent: () => null,
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { UserMessage } from "./message";

describe("UserMessage", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("renders user-authored text with the session body font", () => {
    flushSync(() => {
      root?.render(<UserMessage message="Use the chat font" timestamp={0} />);
    });

    const textElement = Array.from(container?.querySelectorAll("[dir='auto']") ?? []).find(
      (element) => element.textContent === "Use the chat font",
    ) as HTMLElement | undefined;

    expect(textElement).toBeDefined();
    expect(getComputedStyle(textElement!).fontFamily).toContain(theme.fontFamily.body);
  });

  it("renders inline code in user-authored text with the mono font", () => {
    flushSync(() => {
      root?.render(<UserMessage message="Use `pnpm test` before shipping" timestamp={0} />);
    });

    const codeElement = Array.from(container?.querySelectorAll("*") ?? []).find(
      (element) => element.textContent === "pnpm test",
    ) as HTMLElement | undefined;

    expect(codeElement).toBeDefined();
    expect(getComputedStyle(codeElement!).fontFamily).toContain(theme.fontFamily.mono);
  });

  it("renders fenced code blocks in user-authored text with the mono font", () => {
    flushSync(() => {
      root?.render(
        <UserMessage message={"Before\n```ts\nconst answer = 42;\n```\nAfter"} timestamp={0} />,
      );
    });

    const codeElement = Array.from(container?.querySelectorAll("*") ?? []).find(
      (element) => element.textContent === "const answer = 42;",
    ) as HTMLElement | undefined;

    expect(codeElement).toBeDefined();
    expect(getComputedStyle(codeElement!).fontFamily).toContain(theme.fontFamily.mono);
  });
});
