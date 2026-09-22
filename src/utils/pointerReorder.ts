/**
 * Pointer-event based list reordering. Replaces HTML5 drag-and-drop for the
 * workspace tabs: Tauri's native file drop (`dragDropEnabled`) and HTML5
 * `dragstart` are mutually exclusive on Windows, and native file drop wins.
 */
export const TAB_INDEX_ATTR = "data-tab-index";
export const DRAG_THRESHOLD_PX = 4;

export interface ReorderElementLike {
  closest(selector: string): ReorderElementLike | null;
  getAttribute(name: string): string | null;
}

export const findTabIndexAt = (element: ReorderElementLike | null): number | null => {
  const tab = element?.closest(`[${TAB_INDEX_ATTR}]`);
  const raw = tab?.getAttribute(TAB_INDEX_ATTR);
  if (raw === null || raw === undefined) return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

export const exceedsDragThreshold = (
  dx: number,
  dy: number,
  threshold = DRAG_THRESHOLD_PX,
): boolean => Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;

/** Elements whose own pointer interaction must not start a tab drag. */
const NON_DRAG_HANDLE_SELECTOR = "input, textarea, button, [role=\"button\"], .muxpit-tmux-sessions";

export const isReorderHandle = (target: ReorderElementLike | null): boolean =>
  !target?.closest(NON_DRAG_HANDLE_SELECTOR);

export interface PointerReorderCallbacks {
  onDragStart(from: number): void;
  onDragOver(over: number | null): void;
  onDrop(from: number, to: number | null): void;
  onCancel(): void;
}

interface PointerDownLike {
  button: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

interface ReorderDocumentLike {
  addEventListener(type: string, listener: (event: PointerEvent) => void): void;
  removeEventListener(type: string, listener: (event: PointerEvent) => void): void;
  elementFromPoint(x: number, y: number): Element | null;
  body?: { style: { cursor: string; userSelect: string } };
}

/**
 * Call from a tab's `onPointerDown`. Nothing happens until the pointer moves
 * past the threshold, so plain clicks (activate, close button) keep working.
 */
export const startPointerReorder = (
  event: PointerDownLike,
  from: number,
  callbacks: PointerReorderCallbacks,
  doc: ReorderDocumentLike = document,
): void => {
  if (event.button !== 0) return;
  if (!isReorderHandle(event.target as ReorderElementLike | null)) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  const restoreBody = () => {
    if (!doc.body) return;
    doc.body.style.cursor = "";
    doc.body.style.userSelect = "";
  };

  const onMove = (ev: PointerEvent) => {
    if (!dragging) {
      if (!exceedsDragThreshold(ev.clientX - startX, ev.clientY - startY)) return;
      dragging = true;
      callbacks.onDragStart(from);
      if (doc.body) {
        doc.body.style.cursor = "grabbing";
        doc.body.style.userSelect = "none";
      }
    }
    callbacks.onDragOver(findTabIndexAt(doc.elementFromPoint(ev.clientX, ev.clientY)));
  };

  const finish = (ev: PointerEvent, cancelled: boolean) => {
    doc.removeEventListener("pointermove", onMove);
    doc.removeEventListener("pointerup", onUp);
    doc.removeEventListener("pointercancel", onCancel);
    if (!dragging) return;
    restoreBody();
    if (cancelled) {
      callbacks.onCancel();
      return;
    }
    callbacks.onDrop(from, findTabIndexAt(doc.elementFromPoint(ev.clientX, ev.clientY)));
  };
  const onUp = (ev: PointerEvent) => finish(ev, false);
  const onCancel = (ev: PointerEvent) => finish(ev, true);

  doc.addEventListener("pointermove", onMove);
  doc.addEventListener("pointerup", onUp);
  doc.addEventListener("pointercancel", onCancel);
};
