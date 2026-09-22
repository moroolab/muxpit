import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pasteTerminalFiles } from "../src/utils/terminalPaste.ts";
import { findDropLeafId, physicalToClientPoint } from "../src/utils/fileDrop.ts";
import {
  exceedsDragThreshold,
  findTabIndexAt,
  isReorderHandle,
  startPointerReorder,
} from "../src/utils/pointerReorder.ts";

const readSource = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const createSurface = () => {
  const pasted: string[] = [];
  const written: string[] = [];
  return {
    pasted,
    written,
    surface: {
      paste: (text: string) => pasted.push(text),
      write: (data: string) => written.push(data),
    },
  };
};

const sshConnection = { program: "ssh", options: [], target: "me@host" };

test("file drop on a local pane pastes the original paths without uploading", async () => {
  const { pasted, surface } = createSurface();
  let uploaded = false;

  await pasteTerminalFiles({
    paths: [String.raw`C:\Users\Jane Doe\report.pdf`, String.raw`C:\tmp\a.txt`],
    fileStore: {
      pushFileToRemote: async () => {
        uploaded = true;
        return "unexpected";
      },
    },
    surface,
    spawnCommand: null,
    spawnSshConnection: null,
    platform: "windows",
  });

  assert.equal(uploaded, false);
  assert.deepEqual(pasted, [String.raw`"C:\Users\Jane Doe\report.pdf" "C:\tmp\a.txt" `]);
});

test("file drop on a posix local pane uses single quotes", async () => {
  const { pasted, surface } = createSurface();

  await pasteTerminalFiles({
    paths: ["/home/me/it's here.txt"],
    fileStore: { pushFileToRemote: async () => "unexpected" },
    surface,
    spawnCommand: null,
    spawnSshConnection: null,
    platform: "linux",
  });

  assert.deepEqual(pasted, ["'/home/me/it'\\''s here.txt' "]);
});

test("file drop on an ssh pane uploads each file and pastes remote paths", async () => {
  const { pasted, surface } = createSurface();
  const uploads: string[] = [];

  await pasteTerminalFiles({
    paths: ["/local/a.txt", "/local/b.txt"],
    fileStore: {
      pushFileToRemote: async ({ sshCommand, localPath }) => {
        assert.equal(sshCommand, "ssh me@host");
        uploads.push(localPath);
        return `/home/me/.muxpit/files/${localPath.split("/").pop()}`;
      },
    },
    surface,
    spawnCommand: "ssh me@host",
    spawnSshConnection: sshConnection,
    platform: "windows",
  });

  assert.deepEqual(uploads, ["/local/a.txt", "/local/b.txt"]);
  assert.deepEqual(pasted, ["/home/me/.muxpit/files/a.txt /home/me/.muxpit/files/b.txt "]);
});

test("file drop reports per-file upload failures and pastes the rest", async () => {
  const { pasted, written, surface } = createSurface();

  await pasteTerminalFiles({
    paths: ["/local/dir", "/local/ok.bin"],
    fileStore: {
      pushFileToRemote: async ({ localPath }) => {
        if (localPath === "/local/dir") throw new Error("directories are not uploaded: /local/dir");
        return "/home/me/.muxpit/files/ok.bin";
      },
    },
    surface,
    spawnCommand: "ssh me@host",
    spawnSshConnection: sshConnection,
    logError: () => {},
  });

  assert.equal(written.length, 1);
  assert.match(written[0], /file drop failed: .*directories are not uploaded/);
  assert.deepEqual(pasted, ["/home/me/.muxpit/files/ok.bin "]);
});

test("file drop with no resolvable paths pastes nothing", async () => {
  const { pasted, surface } = createSurface();

  await pasteTerminalFiles({
    paths: [],
    fileStore: { pushFileToRemote: async () => "unexpected" },
    surface,
    spawnCommand: null,
    spawnSshConnection: null,
  });

  assert.deepEqual(pasted, []);
});

test("drop hit test converts physical position and resolves the leaf id", () => {
  assert.deepEqual(physicalToClientPoint({ x: 300, y: 150 }, 1.5), { x: 200, y: 100 });
  assert.deepEqual(physicalToClientPoint({ x: 300, y: 150 }, 0), { x: 300, y: 150 });

  const leaf = {
    closest: () => leaf,
    getAttribute: (name: string) => (name === "data-leaf-id" ? "leaf-7" : null),
  };
  const child = { closest: () => leaf, getAttribute: () => null };
  assert.equal(findDropLeafId(child), "leaf-7");
  assert.equal(findDropLeafId({ closest: () => null, getAttribute: () => null }), null);
  assert.equal(findDropLeafId(null), null);
});

test("pointer reorder resolves tab indexes and ignores control handles", () => {
  const tab = {
    closest: (selector: string) => (selector.includes("data-tab-index") ? tab : null),
    getAttribute: () => "3",
  };
  assert.equal(findTabIndexAt(tab), 3);
  assert.equal(findTabIndexAt({ closest: () => null, getAttribute: () => null }), null);

  const closeButton = {
    closest: (selector: string) => (selector.includes("button") ? closeButton : null),
    getAttribute: () => null,
  };
  assert.equal(isReorderHandle(closeButton), false);
  assert.equal(isReorderHandle({ closest: () => null, getAttribute: () => null }), true);

  assert.equal(exceedsDragThreshold(1, 1), false);
  assert.equal(exceedsDragThreshold(4, 0), true);
});

test("pointer reorder only drops after the pointer moves past the threshold", () => {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  let pointAt: number | null = null;
  const tabAt = (index: number) => ({
    closest: () => tabAt(index),
    getAttribute: () => String(index),
  });
  const doc = {
    addEventListener: (type: string, listener: (event: PointerEvent) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    elementFromPoint: () => (pointAt === null ? null : (tabAt(pointAt) as unknown as Element)),
    body: { style: { cursor: "", userSelect: "" } },
  };
  const events: string[] = [];
  const callbacks = {
    onDragStart: (from: number) => events.push(`start:${from}`),
    onDragOver: (over: number | null) => events.push(`over:${over}`),
    onDrop: (from: number, to: number | null) => events.push(`drop:${from}->${to}`),
    onCancel: () => events.push("cancel"),
  };
  const plainTarget = { closest: () => null, getAttribute: () => null };

  // Plain click: no movement, no drag callbacks, listeners cleaned up.
  startPointerReorder({ button: 0, clientX: 10, clientY: 10, target: plainTarget as unknown as EventTarget }, 0, callbacks, doc);
  listeners.get("pointerup")!({ clientX: 10, clientY: 10 } as PointerEvent);
  assert.deepEqual(events, []);
  assert.equal(listeners.size, 0);

  // Drag from tab 0 over tab 2 and release.
  startPointerReorder({ button: 0, clientX: 10, clientY: 10, target: plainTarget as unknown as EventTarget }, 0, callbacks, doc);
  listeners.get("pointermove")!({ clientX: 11, clientY: 10 } as PointerEvent);
  assert.deepEqual(events, []);
  pointAt = 2;
  listeners.get("pointermove")!({ clientX: 40, clientY: 10 } as PointerEvent);
  assert.equal(doc.body.style.userSelect, "none");
  listeners.get("pointerup")!({ clientX: 40, clientY: 10 } as PointerEvent);
  assert.deepEqual(events, ["start:0", "over:2", "drop:0->2"]);
  assert.equal(doc.body.style.userSelect, "");
  assert.equal(listeners.size, 0);

  // Right button never starts a drag.
  startPointerReorder({ button: 2, clientX: 0, clientY: 0, target: plainTarget as unknown as EventTarget }, 1, callbacks, doc);
  assert.equal(listeners.size, 0);
});

test("workspace tabs no longer rely on HTML5 drag and native drop is enabled", () => {
  const sidebar = readSource("../src/components/Sidebar.tsx");
  const topBar = readSource("../src/components/TopDashboardBar.tsx");
  const terminal = readSource("../src/components/Terminal.tsx");
  const tauriConf = readSource("../src-tauri/tauri.conf.json");

  assert.doesNotMatch(sidebar, /draggable=|onDragStart=|onDrop=/);
  assert.doesNotMatch(topBar, /draggable|onDragStart=|onDrop=/);
  assert.match(sidebar, /startPointerReorder/);
  assert.match(topBar, /startPointerReorder/);
  assert.match(terminal, /TERMINAL_LEAF_ATTR/);
  assert.doesNotMatch(tauriConf, /"dragDropEnabled": false/);
});
