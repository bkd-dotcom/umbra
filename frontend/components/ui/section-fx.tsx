/* A section-specific ambient so each landing section clearly reads as its own
   "room" — a distinct accent wash, an edge treatment, and a top rule. Purely
   decorative and non-interactive; drop it as the FIRST child of a `relative`
   section so content (later siblings) paints on top. Static (zero scroll cost).
   `accent` is a 6-digit hex; alpha is appended as hex (e.g. `${accent}33` ≈ 20%). */
export function SectionFX({
  accent,
  variant = "top",
  rule = true,
}: {
  accent: string;
  variant?: "top" | "left" | "right" | "grid" | "beam";
  rule?: boolean;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {rule && (
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: 0.5 }} />
      )}

      {variant === "top" && (
        <div className="absolute inset-0" style={{ background: `radial-gradient(58rem 30rem at 50% -6%, ${accent}30, transparent 60%)` }} />
      )}

      {variant === "left" && (
        <>
          <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `linear-gradient(180deg, transparent, ${accent}, transparent)`, opacity: 0.7 }} />
          <div className="absolute inset-0" style={{ background: `radial-gradient(46rem 40rem at -4% 32%, ${accent}2b, transparent 58%)` }} />
        </>
      )}

      {variant === "right" && (
        <>
          <div className="absolute inset-y-0 right-0 w-[3px]" style={{ background: `linear-gradient(180deg, transparent, ${accent}, transparent)`, opacity: 0.7 }} />
          <div className="absolute inset-0" style={{ background: `radial-gradient(46rem 40rem at 104% 32%, ${accent}2b, transparent 58%)` }} />
        </>
      )}

      {variant === "beam" && (
        <div className="absolute inset-0" style={{ background: `linear-gradient(115deg, transparent 28%, ${accent}22 48%, ${accent}10 56%, transparent 72%)` }} />
      )}

      {variant === "grid" && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(${accent}3a 1px, transparent 1px)`,
            backgroundSize: "26px 26px",
            WebkitMaskImage: "radial-gradient(75% 62% at 50% 16%, black, transparent)",
            maskImage: "radial-gradient(75% 62% at 50% 16%, black, transparent)",
          }}
        />
      )}
    </div>
  );
}
