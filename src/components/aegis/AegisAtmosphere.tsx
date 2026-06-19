/**
 * AegisAtmosphere — Slice 2A "Aegis Magical Core" environment lighting.
 *
 * PURELY DECORATIVE. Provides the canvas lighting that ties the core to the command
 * bar: soft background blooms, a depth vignette, a vertical light "beam" between the
 * core and the command surface, and a glow that seats the command bar — with the
 * SIGNATURE attention pulse (~11s) where light descends from the core and the command-
 * bar glow brightens in sync, so Aegis appears to energize the command surface.
 *
 * No data, no labels, no operational claims. aria-hidden + pointer-events-none; the
 * caller mounts it as a behind-content (-z-10) full-canvas layer. Additive light via
 * mix-blend screen. All motion gated by prefers-reduced-motion (reduced-motion = calm
 * static lighting: beam hidden, command-bar glow steady).
 */
export const AegisAtmosphere = ({ className = "" }: { className?: string }) => {
  return (
    <div aria-hidden="true" className={`pointer-events-none select-none ${className}`}>
      {/* Background blooms (additive light) */}
      <div
        className="absolute inset-0"
        style={{
          mixBlendMode: "screen",
          background:
            "radial-gradient(58% 48% at 50% 33%, hsl(var(--primary) / 0.15), transparent 70%), radial-gradient(40% 30% at 20% 60%, hsl(var(--primary) / 0.06), transparent 70%), radial-gradient(40% 30% at 82% 64%, hsl(var(--primary) / 0.05), transparent 70%)",
        }}
      />
      {/* Depth vignette (darkens edges, focuses the core) */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 92% at 50% 30%, transparent 55%, hsl(222 47% 3% / 0.6) 100%)" }}
      />
      {/* Attention beam: descends core -> command bar (pulses ~11s; hidden when static) */}
      <div
        className="ac-beam absolute left-1/2 -translate-x-1/2 top-[36%] bottom-[9%] w-40 sm:w-56 opacity-0"
        style={{
          mixBlendMode: "screen",
          background: "linear-gradient(180deg, hsl(var(--primary) / 0), hsl(var(--primary) / 0.18) 32%, hsl(var(--primary) / 0))",
          maskImage: "linear-gradient(180deg, transparent, black 18%, black 82%, transparent)",
          WebkitMaskImage: "linear-gradient(180deg, transparent, black 18%, black 82%, transparent)",
        }}
      />
      {/* Command-bar glow seat (soft idle glow, brightens in sync with the pulse) */}
      <div
        className="ac-barglow absolute left-1/2 -translate-x-1/2 bottom-[5%] w-72 sm:w-[34rem] h-24 opacity-50"
        style={{
          mixBlendMode: "screen",
          background: "radial-gradient(60% 80% at 50% 62%, hsl(var(--primary) / 0.22), transparent 72%)",
        }}
      />

      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .ac-beam { animation: ac-beam 11s ease-in-out infinite; }
          .ac-barglow { animation: ac-barglow 11s ease-in-out infinite; }
        }
        @keyframes ac-beam {
          0%, 72%, 100% { opacity: 0; }
          80% { opacity: 0.7; }
          88% { opacity: 0.25; }
        }
        @keyframes ac-barglow {
          0%, 74%, 100% { opacity: 0.5; }
          82% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};
