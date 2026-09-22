export const TERMINAL_LEAF_ATTR = "data-leaf-id";

export interface DropPoint {
  x: number;
  y: number;
}

export interface DropTargetElementLike {
  closest(selector: string): DropTargetElementLike | null;
  getAttribute(name: string): string | null;
}

/**
 * Tauri reports drag positions in physical pixels relative to the webview.
 * `document.elementFromPoint` wants CSS pixels, and `devicePixelRatio` already
 * folds in the page zoom the app applies via `setZoom`.
 */
export const physicalToClientPoint = (
  position: DropPoint,
  devicePixelRatio: number,
): DropPoint => {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: position.x / ratio, y: position.y / ratio };
};

export const findDropLeafId = (element: DropTargetElementLike | null): string | null => {
  const leaf = element?.closest(`[${TERMINAL_LEAF_ATTR}]`);
  const leafId = leaf?.getAttribute(TERMINAL_LEAF_ATTR);
  return leafId && leafId.length > 0 ? leafId : null;
};
