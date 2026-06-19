/**
 * AegisGhostFrames — Slice 2A-Reframe v2.
 *
 * PURELY DECORATIVE spatial atmosphere: faint abstract frames arranged around the
 * Aegis core to give the canvas depth/architecture. They are SILHOUETTES ONLY —
 * no text, no titles, no counts, no statuses, no icons that imply data. They make
 * no claim and must never be mistaken for real cards/documents/reports.
 *
 * Safety: aria-hidden + pointer-events-none + select-none; the caller places this
 * as a behind-content (-z-10) backdrop layer. Hidden on small screens to avoid
 * mobile clutter. No motion (nothing to gate for reduced-motion).
 */
export const AegisGhostFrames = ({ className = "" }: { className?: string }) => {
  return (
    <div aria-hidden="true" className={`pointer-events-none select-none ${className}`}>
      <div className="absolute left-[7%] top-[44%] hidden md:block w-44 h-28 rounded-xl border border-primary/15 bg-primary/[0.03] backdrop-blur-[1px]" />
      <div className="absolute right-[8%] top-[39%] hidden lg:block w-40 h-32 rounded-xl border border-primary/15 bg-primary/[0.03] backdrop-blur-[1px]" />
      <div className="absolute left-1/2 top-[58%] -translate-x-1/2 hidden sm:block w-48 h-24 rounded-xl border border-primary/10 bg-primary/[0.02]" />
    </div>
  );
};
