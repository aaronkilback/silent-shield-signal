/**
 * AegisAtmosphere — Slice 2A environment lighting + Slice 4A (Option C) activity coupling.
 *
 * PURELY DECORATIVE. A depth vignette, a vertical light beam between the core and the
 * command bar, and a glow that seats the command bar. As of Slice 4A the beam + glow are
 * driven by REAL session activity (`active`) instead of a purely timed pulse:
 *   - idle  => calm baseline (soft steady command-bar glow, no beam)
 *   - active => beam appears + glow brightens (Aegis is actually thinking/streaming/voice)
 *
 * No data, no labels, no counts, no operational claims. aria-hidden + pointer-events-none;
 * caller mounts it behind content (-z-10). Additive light via mix-blend screen. Opacity
 * eases via motion-safe transition only (reduced-motion changes state instantly, no loop).
 */
export const AegisAtmosphere = ({ className = "", active = false }: { className?: string; active?: boolean }) => {
  return (
    <div aria-hidden="true" className={`pointer-events-none select-none ${className}`}>
      {/* Depth vignette (canvas provides the upper atmosphere) */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 92% at 50% 30%, transparent 55%, hsl(222 47% 3% / 0.6) 100%)" }}
      />
      {/* Attention beam core -> command bar: visible only when Aegis is really active */}
      <div
        className="absolute left-1/2 -translate-x-1/2 top-[62%] bottom-[8%] w-40 sm:w-56 motion-safe:transition-opacity motion-safe:duration-700"
        style={{
          opacity: active ? 0.6 : 0,
          mixBlendMode: "screen",
          background: "linear-gradient(180deg, hsl(var(--primary) / 0), hsl(var(--primary) / 0.18) 32%, hsl(var(--primary) / 0))",
          maskImage: "linear-gradient(180deg, transparent, black 18%, black 82%, transparent)",
          WebkitMaskImage: "linear-gradient(180deg, transparent, black 18%, black 82%, transparent)",
        }}
      />
      {/* Command-bar glow seat: soft idle baseline, brighter when Aegis is active */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-[5%] w-72 sm:w-[34rem] h-24 motion-safe:transition-opacity motion-safe:duration-700"
        style={{
          opacity: active ? 0.9 : 0.4,
          mixBlendMode: "screen",
          background: "radial-gradient(60% 80% at 50% 62%, hsl(var(--primary) / 0.22), transparent 72%)",
        }}
      />
    </div>
  );
};
