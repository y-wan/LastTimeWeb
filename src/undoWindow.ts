export const UNDO_WINDOW_MS = 10_000

export function startUndoWindow(onExpire: () => void) {
  return window.setTimeout(onExpire, UNDO_WINDOW_MS)
}
