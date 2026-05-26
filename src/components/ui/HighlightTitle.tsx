"use client";

/**
 * Render a title where a configurable substring is wrapped with the
 * existing `neon-text` gradient class.
 *
 *  - First case-sensitive occurrence of `gradient` inside `text` is highlighted.
 *  - Empty `gradient` or non-matching value renders the title as-is, which
 *    cleanly degrades when an admin clears the highlight field.
 *  - The gradient class itself is the existing one in globals.css — we
 *    do not introduce new colors or effects.
 */
export function HighlightTitle({
  text,
  gradient,
  as: Tag = "span",
  className,
}: {
  text: string;
  gradient?: string;
  as?: "span" | "h1" | "h2" | "div";
  className?: string;
}) {
  const g = (gradient || "").trim();
  if (!g) {
    return <Tag className={className}>{text}</Tag>;
  }

  const idx = text.indexOf(g);
  if (idx === -1) {
    return <Tag className={className}>{text}</Tag>;
  }

  const before = text.slice(0, idx);
  const middle = text.slice(idx, idx + g.length);
  const after = text.slice(idx + g.length);

  return (
    <Tag className={className}>
      {before}
      <span className="neon-text">{middle}</span>
      {after}
    </Tag>
  );
}
