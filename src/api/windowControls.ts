import { getCurrentWindow } from "@tauri-apps/api/window";

export function startWindowDrag() {
  getCurrentWindow().startDragging().catch(() => undefined);
}

export function minimizeWindow() {
  void getCurrentWindow().minimize();
}

export function closeWindow() {
  void getCurrentWindow().close();
}
