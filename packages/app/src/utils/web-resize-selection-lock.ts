import { isWeb } from "@/constants/platform";

const LOCK_ATTRIBUTE = "data-paseo-resize-selection-lock";
const LOCK_STYLE_ID = "paseo-resize-selection-lock-style";

let lockDepth = 0;
let previousBodyCursor: string | null = null;

function canUseWebDocument(): boolean {
  return isWeb && typeof document !== "undefined" && Boolean(document.body);
}

function ensureLockStyle(): void {
  if (document.getElementById(LOCK_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = LOCK_STYLE_ID;
  style.textContent = `
html[${LOCK_ATTRIBUTE}],
html[${LOCK_ATTRIBUTE}] * {
  -webkit-user-select: none !important;
  user-select: none !important;
}
`;
  document.head.appendChild(style);
}

function clearWebSelection(): void {
  const selection = typeof window !== "undefined" ? window.getSelection?.() : null;
  if (selection && selection.rangeCount > 0) {
    selection.removeAllRanges();
  }
}

export function beginWebResizeSelectionLock(cursor = "col-resize"): void {
  if (!canUseWebDocument()) {
    return;
  }

  if (lockDepth === 0) {
    previousBodyCursor = document.body.style.cursor;
    ensureLockStyle();
    document.documentElement.setAttribute(LOCK_ATTRIBUTE, "true");
  }

  lockDepth += 1;
  document.body.style.cursor = cursor;
  clearWebSelection();
}

export function endWebResizeSelectionLock(): void {
  if (!canUseWebDocument() || lockDepth <= 0) {
    return;
  }

  lockDepth -= 1;
  if (lockDepth > 0) {
    return;
  }

  document.documentElement.removeAttribute(LOCK_ATTRIBUTE);
  document.body.style.cursor = previousBodyCursor ?? "";
  previousBodyCursor = null;
  clearWebSelection();
}
