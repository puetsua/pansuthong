import { CSSProperties, useEffect, useRef, useState } from "react";

type Props = { text: string; className?: string };

/**
 * Single-line text that scrolls horizontally on hover when it's too wide for its
 * box, so a long label stays fully readable without widening the layout. When it
 * fits, it renders as plain (no animation). Overflow is measured from the DOM, so
 * it degrades to "fits" in non-layout environments (e.g. jsdom tests).
 */
export function MarqueeText({ text, className }: Props) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => setShift(Math.max(0, i.scrollWidth - o.clientWidth));
    measure();
    // Re-measure when the box can change width (window resize / font load).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(o);
    return () => ro?.disconnect();
  }, [text]);

  const style = {
    "--marquee-shift": `${shift}px`,
    // ~30px/s so longer labels scroll proportionally longer, with a sane floor.
    "--marquee-dur": `${Math.max(2, shift / 30)}s`,
  } as CSSProperties;

  return (
    <span ref={outer} className={`marquee${className ? ` ${className}` : ""}`}
          data-overflow={shift > 0} style={style} title={text}>
      <span ref={inner} className="marquee-inner">{text}</span>
    </span>
  );
}
