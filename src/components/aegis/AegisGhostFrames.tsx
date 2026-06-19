/**
 * AegisGhostFrames — Slice 2A "Aegis Magical Core" (redesigned).
 *
 * PURELY DECORATIVE holographic HUD reticles (corner brackets only — NOT filled
 * cards/panels) that add spatial/command-interface depth around the core. No full
 * borders, no fill, no text, no titles, no counts, no statuses — they cannot be
 * mistaken for real document/report/agent cards.
 *
 * aria-hidden + pointer-events-none + select-none; caller mounts behind content
 * (-z-10). md+ only (kept off small screens to avoid clutter). No motion.
 */
const Reticle = ({ className = "" }: { className?: string }) => (
  <div className={`absolute hidden md:block w-24 h-16 opacity-[0.18] ${className}`}>
    <span className="absolute left-0 top-0 h-3.5 w-3.5 border-l border-t border-primary rounded-tl-sm" />
    <span className="absolute right-0 top-0 h-3.5 w-3.5 border-r border-t border-primary rounded-tr-sm" />
    <span className="absolute left-0 bottom-0 h-3.5 w-3.5 border-l border-b border-primary rounded-bl-sm" />
    <span className="absolute right-0 bottom-0 h-3.5 w-3.5 border-r border-b border-primary rounded-br-sm" />
  </div>
);

export const AegisGhostFrames = ({ className = "" }: { className?: string }) => {
  return (
    <div aria-hidden="true" className={`pointer-events-none select-none ${className}`}>
      <Reticle className="left-[9%] top-[40%]" />
      <Reticle className="right-[10%] top-[36%]" />
    </div>
  );
};
