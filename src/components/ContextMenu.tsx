import { useEffect, useRef } from "react";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export default function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onBlur = () => onClose();
    const onResize = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ position: "fixed", left: state.x, top: state.y, zIndex: 2000 }}
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          type="button"
          className={`context-menu-item${item.danger ? " danger" : ""}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
