import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MIN_PTY_COLS,
  MIN_PTY_ROWS,
  MIN_TERMINAL_FIT_PX,
  shouldFitTerminalSurface,
  shouldResizePty,
} from "../src/utils/terminalFit.ts";

test("terminal fit skips minimized or collapsed panes", () => {
  assert.equal(
    shouldFitTerminalSurface({ width: 800, height: 600, hidden: false }),
    true,
  );
  assert.equal(
    shouldFitTerminalSurface({ width: 800, height: 600, hidden: true }),
    false,
  );
  assert.equal(
    shouldFitTerminalSurface({ width: 0, height: 600, hidden: false }),
    false,
  );
  assert.equal(
    shouldFitTerminalSurface({ width: 800, height: MIN_TERMINAL_FIT_PX - 1, hidden: false }),
    false,
  );
});

test("pty resize skips hidden windows and 1x1 collapse", () => {
  assert.equal(shouldResizePty({ rows: 24, cols: 80, hidden: false }), true);
  assert.equal(shouldResizePty({ rows: 24, cols: 80, hidden: true }), false);
  assert.equal(shouldResizePty({ rows: 1, cols: 80, hidden: false }), false);
  assert.equal(shouldResizePty({ rows: 24, cols: MIN_PTY_COLS - 1, hidden: false }), false);
  assert.equal(shouldResizePty({ rows: MIN_PTY_ROWS, cols: MIN_PTY_COLS, hidden: false }), true);
});

test("terminal fit and pty resize are wired to skip collapse on minimize", () => {
  const terminal = readFileSync(new URL("../src/components/Terminal.tsx", import.meta.url), "utf8");
  const session = readFileSync(new URL("../src/hooks/useTerminalSession.ts", import.meta.url), "utf8");

  assert.match(terminal, /shouldFitTerminalSurface/);
  assert.match(session, /shouldResizePty/);
});
