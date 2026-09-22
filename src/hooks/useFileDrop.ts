import { useEffect } from "react";
import { terminalInstances } from "../components/terminalRegistry";
import { useFileDropStore } from "../stores/fileDrop";
import { findDropLeafId, physicalToClientPoint, type DropPoint } from "../utils/fileDrop";
import { tauriPtyBackend } from "../utils/tauriPtyBackend";
import { pasteTerminalFiles } from "../utils/terminalPaste";
import { tryGetCurrentWebview } from "../utils/tauriWindow";

const leafIdAtPhysicalPoint = (position: DropPoint): string | null => {
  const point = physicalToClientPoint(position, window.devicePixelRatio);
  return findDropLeafId(document.elementFromPoint(point.x, point.y));
};

/**
 * Routes native OS file drops (Tauri drag-drop events) to the terminal pane
 * under the cursor. Local panes get the original paths; SSH panes upload
 * first. Registered once at the app root.
 */
export const useFileDrop = () => {
  useEffect(() => {
    const webview = tryGetCurrentWebview();
    if (!webview) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const setTarget = (leafId: string | null) =>
      useFileDropStore.getState().setTargetLeafId(leafId);

    void webview.onDragDropEvent((event) => {
      if (disposed) return;
      const payload = event.payload;
      if (payload.type === "leave") {
        setTarget(null);
        return;
      }
      if (payload.type === "enter" || payload.type === "over") {
        setTarget(leafIdAtPhysicalPoint(payload.position));
        return;
      }

      const leafId = leafIdAtPhysicalPoint(payload.position);
      setTarget(null);
      if (!leafId) return;
      const instance = terminalInstances.get(leafId);
      if (!instance) return;
      void pasteTerminalFiles({
        paths: payload.paths,
        fileStore: tauriPtyBackend,
        surface: instance.surface,
        spawnCommand: instance.spawnCommand,
        spawnSshConnection: instance.spawnSshConnection,
      });
      instance.surface.focus();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    }).catch((err) => console.error("[muxpit] drag-drop listen failed:", err));

    return () => {
      disposed = true;
      unlisten?.();
      setTarget(null);
    };
  }, []);
};
