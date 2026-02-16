import { useRef, useState, useCallback, type ReactNode } from "react";

interface DraggablePanelProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Disable drag (e.g. while hidden) */
  disabled?: boolean;
}

export function DraggablePanel({ children, className = "", style, disabled }: DraggablePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    // Only drag from the panel header area (first 40px) or if target has data-drag-handle
    const target = e.target as HTMLElement;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Allow drag from top 36px of the panel OR any element with data-drag-handle
    const isHandle = target.closest("[data-drag-handle]");
    const isTopArea = e.clientY - rect.top < 36;
    if (!isHandle && !isTopArea) return;

    dragging.current = true;
    start.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [disabled, offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setOffset({
      x: start.current.ox + (e.clientX - start.current.x),
      y: start.current.oy + (e.clientY - start.current.y),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={panelRef}
      className={className}
      style={{
        ...style,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        cursor: disabled ? undefined : "grab",
        userSelect: dragging.current ? "none" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {children}
    </div>
  );
}
