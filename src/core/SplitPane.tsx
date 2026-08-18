import { Fragment, type ReactNode, useRef } from "react";

interface SplitPaneProps {
  direction: "horizontal" | "vertical";
  sizes: number[];
  minSizes: number[];
  collapsed: boolean[];
  onSizes: (sizes: number[]) => void;
  onToggle: (index: number) => void;
  flexIndex?: number;
  children: ReactNode[];
}

export default function SplitPane({
  direction,
  sizes,
  minSizes,
  collapsed,
  onSizes,
  onToggle,
  flexIndex,
  children,
}: SplitPaneProps) {
  const flex = flexIndex ?? children.length - 1;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    divider: number;
    fixed: number;
    start: number;
    base: number;
  } | null>(null);

  const horizontal = direction === "horizontal";

  const startDrag = (divider: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const fixed =
      divider === flex ? divider + 1 : divider;
    dragRef.current = {
      divider,
      fixed,
      start: horizontal ? e.clientX : e.clientY,
      base: sizes[fixed],
    };
  };

  const moveDrag = (divider: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.divider !== divider) return;
    const pos = horizontal ? e.clientX : e.clientY;
    const container = containerRef.current;
    if (!container) return;
    const total = horizontal ? container.clientWidth : container.clientHeight;
    const othersMin = minSizes.reduce(
      (acc, m, idx) => (idx === d.fixed ? acc : acc + m),
      0,
    );
    const max = Math.max(minSizes[d.fixed], total - othersMin - 48);
    const sign = d.fixed === divider ? 1 : -1;
    let next = d.base + sign * (pos - d.start);
    next = Math.max(minSizes[d.fixed], Math.min(next, max));
    const newSizes = [...sizes];
    newSizes[d.fixed] = next;
    onSizes(newSizes);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div ref={containerRef} className={"split split-" + direction}>
      {children.map((child, i) => (
        <Fragment key={i}>
          <div
            className="split-pane"
            style={
              i === flex
                ? { flex: "1 1 auto", minWidth: 0, minHeight: 0 }
                : horizontal
                  ? { width: collapsed[i] ? 28 : sizes[i] }
                  : { height: collapsed[i] ? 28 : sizes[i] }
            }
          >
            <div className="split-pane-inner">{child}</div>
          </div>
          {i < children.length - 1 && (
            <div
              className={
                "split-divider" +
                (collapsed[i] && i !== flex ? " collapsed" : "")
              }
              onPointerDown={startDrag(i)}
              onPointerMove={moveDrag(i)}
              onPointerUp={endDrag}
              onDoubleClick={() => onToggle(i)}
              title="Arrastra para redimensionar · doble clic para colapsar"
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
