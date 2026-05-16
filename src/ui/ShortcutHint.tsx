import type { ReactNode } from "react";
import type { ShortcutBinding } from "../types/domain";

type ShortcutHintProps = {
  shortcut?: ShortcutBinding;
  children: ReactNode;
};

export function ShortcutHint({ shortcut, children }: ShortcutHintProps) {
  return (
    <span className="hint-wrap" data-tooltip={shortcut ? `${shortcut.label}: ${shortcut.keys}` : "Kısayol atanmadı"}>
      {children}
    </span>
  );
}

