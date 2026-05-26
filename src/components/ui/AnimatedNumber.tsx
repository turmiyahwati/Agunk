"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Smooth count-up/down animation for numeric values.
 * Uses requestAnimationFrame for buttery-smooth transitions and a small
 * pulse class is applied during transition for the "alive" feel.
 */
export function AnimatedNumber({
  value,
  duration = 700,
  format,
  className,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (value === display) return;
    fromRef.current = display;
    startRef.current = null;
    setPulse(true);

    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const progress = Math.min(1, elapsed / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(progress === 1 ? value : next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setTimeout(() => setPulse(false), 200);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const out = Number.isFinite(display) ? Math.round(display) : 0;
  const text = format ? format(out) : out.toLocaleString();

  return (
    <span
      className={`tabular-nums transition-[text-shadow] duration-500 ${pulse ? "drop-shadow-[0_0_8px_rgba(34,211,238,0.65)]" : ""} ${className ?? ""}`}
    >
      {text}
    </span>
  );
}
