import { useEffect } from "react";

type ShortcutAction = {
  keys: string;
  enabled?: boolean;
  run: () => void;
};

const editableTags = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useShortcuts(actions: ShortcutAction[]) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return;
      const action = actions.find((item) => item.enabled !== false && matchesShortcut(event, item.keys));
      if (!action) return;
      event.preventDefault();
      action.run();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}

function matchesShortcut(event: KeyboardEvent, keys: string) {
  const normalized = keys.toLowerCase();
  if (normalized.includes("+")) {
    const parts = normalized.split("+");
    const key = parts[parts.length - 1] ?? "";
    const wantsCtrl = parts.includes("ctrl");
    const wantsShift = parts.includes("shift");
    const wantsAlt = parts.includes("alt");
    return event.ctrlKey === wantsCtrl && event.shiftKey === wantsShift && event.altKey === wantsAlt && event.key.toLowerCase() === key.toLowerCase();
  }
  if (normalized === "space") return event.code === "Space";
  if (normalized === "delete") return event.key === "Delete" || event.key === "Backspace";
  if (normalized === "+") return event.key === "+" || event.key === "=";
  if (normalized === "-") return event.key === "-";
  return event.key.toLowerCase() === normalized;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return editableTags.has(target.tagName) || target.isContentEditable;
}
