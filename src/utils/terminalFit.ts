/** Skip fit/PTY resize when the window is minimized or the pane has collapsed. */
export const MIN_TERMINAL_FIT_PX = 24;
export const MIN_PTY_ROWS = 2;
export const MIN_PTY_COLS = 4;

export const shouldFitTerminalSurface = ({
  width,
  height,
  hidden,
}: {
  width: number;
  height: number;
  hidden: boolean;
}): boolean =>
  !hidden && width >= MIN_TERMINAL_FIT_PX && height >= MIN_TERMINAL_FIT_PX;

export const shouldResizePty = ({
  rows,
  cols,
  hidden,
}: {
  rows: number;
  cols: number;
  hidden: boolean;
}): boolean =>
  !hidden && rows >= MIN_PTY_ROWS && cols >= MIN_PTY_COLS;
