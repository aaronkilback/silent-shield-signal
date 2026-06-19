/**
 * AegisCore — Slice 2A "Aegis Magical Core" art-direction pass.
 *
 * PURELY DECORATIVE living-intelligence core. Makes NO operational claim: no data,
 * no counts, no agent/node labels, no watching/monitoring/scanning/on-station/
 * investigating language, no live-state. Every ring/path/node is abstract atmosphere.
 *
 * Depth-layered SVG scene (back -> front): far neural field, orbital rings, active
 * energy paths (travelling pulses), depth-graded nodes, a VOLUMETRIC glass core
 * (layered radial gradients + limited feGaussianBlur bloom + inner luminous core +
 * energy chevron), and foreground shimmer motes. Additive light via mix-blend screen.
 *
 * Safety / perf:
 *  - aria-hidden + pointer-events-none + select-none; caller positions it as a
 *    behind-content (-z-10) backdrop. Not a page overlay, no z-index over content.
 *  - Single theme colour via currentColor / hsl(var(--primary)); no external fonts/@import.
 *  - Blur filters capped at THREE (energy-paths glow, core bloom, inner core). Halos use
 *    gradients (no filter). Foreground motes are md+ only. No SVG mask (mobile perf).
 *  - ALL motion lives inside @media (prefers-reduced-motion: no-preference): reduced-motion
 *    users get a rich STATIC volumetric scene (not a dead logo).
 */
export const AegisCore = ({ className = "" }: { className?: string }) => {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none overflow-hidden flex items-center justify-center text-primary ${className}`}
    >
      <svg
        viewBox="0 0 240 240"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-auto max-w-full overflow-visible"
        fill="none"
        focusable="false"
      >
        <defs>
          <radialGradient id="ac-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="42%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ac-coreHot" cx="50%" cy="42%" r="58%">
            <stop offset="0%" stopColor="#e6f0ff" stopOpacity="0.95" />
            <stop offset="38%" stopColor="currentColor" stopOpacity="0.6" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ac-glass" x1="120" y1="84" x2="120" y2="171" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="ac-edge" x1="120" y1="80" x2="120" y2="172" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#cfe0ff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.45" />
          </linearGradient>
          <filter id="ac-soft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id="ac-bigblur" x="-90%" y="-90%" width="280%" height="280%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* L2 — far neural field (dim, static; reads as distance) */}
        <g fill="currentColor" opacity="0.4">
          <circle cx="44" cy="60" r="1" />
          <circle cx="196" cy="70" r="1" />
          <circle cx="60" cy="190" r="1" />
          <circle cx="186" cy="186" r="1.1" />
          <circle cx="30" cy="130" r="0.9" />
          <circle cx="210" cy="120" r="0.9" />
          <circle cx="120" cy="26" r="1" />
        </g>

        {/* L3 — orbital rings (sphere illusion, slow counter-drift) */}
        <g stroke="currentColor" fill="none">
          <g className="ac-spin-cw" style={{ transformBox: "view-box", transformOrigin: "120px 120px" }}>
            <circle cx="120" cy="120" r="90" opacity="0.09" />
            <ellipse cx="120" cy="120" rx="90" ry="34" opacity="0.11" />
            <ellipse cx="120" cy="120" rx="34" ry="90" opacity="0.08" />
            <ellipse cx="120" cy="120" rx="90" ry="52" opacity="0.06" transform="rotate(30 120 120)" />
          </g>
          <g className="ac-spin-ccw" style={{ transformBox: "view-box", transformOrigin: "120px 120px" }}>
            <ellipse cx="120" cy="120" rx="72" ry="90" opacity="0.05" />
            <ellipse cx="120" cy="120" rx="90" ry="52" opacity="0.05" transform="rotate(-30 120 120)" />
          </g>
        </g>

        {/* L4 — active energy paths: a bright short dash travels each link (glow via blur) */}
        <g stroke="currentColor" fill="none" strokeWidth="1.4" strokeLinecap="round" filter="url(#ac-soft)" opacity="0.85">
          <line x1="120" y1="120" x2="58" y2="74" strokeDasharray="2 70" className="ac-flow" />
          <line x1="120" y1="120" x2="190" y2="92" strokeDasharray="2 70" className="ac-flow ac-flow-2" />
          <line x1="120" y1="120" x2="120" y2="36" strokeDasharray="2 70" className="ac-flow ac-flow-3" />
          <line x1="120" y1="120" x2="172" y2="170" strokeDasharray="2 70" className="ac-flow ac-flow-2" />
          <line x1="120" y1="120" x2="64" y2="166" strokeDasharray="2 70" className="ac-flow ac-flow-3" />
        </g>

        {/* L5 — nodes: depth-graded; near are larger/brighter + gradient halo; far static-dim */}
        <g>
          {/* near + haloed */}
          <circle cx="58" cy="74" r="9" fill="url(#ac-bloom)" />
          <circle cx="58" cy="74" r="2.6" fill="currentColor" className="ac-node" />
          <circle cx="172" cy="170" r="9" fill="url(#ac-bloom)" />
          <circle cx="172" cy="170" r="2.4" fill="currentColor" className="ac-node ac-node-3" />
          <circle cx="190" cy="92" r="2.2" fill="currentColor" className="ac-node ac-node-2" />
          {/* mid */}
          <circle cx="120" cy="36" r="1.6" fill="currentColor" className="ac-node ac-node-2" />
          <circle cx="64" cy="166" r="1.6" fill="currentColor" className="ac-node" />
          {/* far (static, dim) */}
          <circle cx="206" cy="140" r="1.3" fill="currentColor" opacity="0.4" />
          <circle cx="40" cy="116" r="1.3" fill="currentColor" opacity="0.4" />
        </g>

        {/* L6 — volumetric core */}
        {/* outer bloom (breathing, additive light) */}
        <circle
          cx="120" cy="126" r="58"
          fill="url(#ac-bloom)"
          filter="url(#ac-bigblur)"
          className="ac-breathe"
          style={{ transformBox: "view-box", transformOrigin: "120px 126px", mixBlendMode: "screen" }}
        />
        {/* shield as semi-transparent glass with luminous edge */}
        <path
          d="M120 84 L146 96 L146 138 Q146 153 120 171 Q94 153 94 138 L94 96 Z"
          fill="url(#ac-glass)"
          stroke="url(#ac-edge)"
          strokeWidth="1.6"
        />
        {/* inner luminous core (light from within), breathing */}
        <ellipse
          cx="120" cy="129" rx="19" ry="25"
          fill="url(#ac-coreHot)"
          filter="url(#ac-soft)"
          className="ac-breathe"
          style={{ transformBox: "view-box", transformOrigin: "120px 129px" }}
        />
        {/* energy chevron — luminous, soft (reads as energy, not a hard logo glyph) */}
        <g stroke="#e6f0ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.92">
          <path d="M108 138 L120 116 L132 138" />
          <line x1="120" y1="120" x2="120" y2="150" />
        </g>
        {/* top-left edge specular highlight */}
        <path d="M120 84 L146 96" stroke="#e6f0ff" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />

        {/* L7 — foreground shimmer motes (md+ only for mobile perf) */}
        <g fill="#e6f0ff" className="hidden md:block">
          <circle cx="96" cy="150" r="0.9" className="ac-mote" />
          <circle cx="142" cy="158" r="0.8" className="ac-mote ac-mote-2" />
          <circle cx="112" cy="146" r="0.7" className="ac-mote ac-mote-3" />
        </g>

        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .ac-spin-cw { animation: ac-spin 90s linear infinite; }
            .ac-spin-ccw { animation: ac-spin-r 130s linear infinite; }
            .ac-breathe { animation: ac-breathe 7s ease-in-out infinite; }
            .ac-flow { animation: ac-flow 2.6s linear infinite; }
            .ac-flow-2 { animation-duration: 3.4s; animation-delay: 0.6s; }
            .ac-flow-3 { animation-duration: 3s; animation-delay: 1.2s; }
            .ac-node { animation: ac-node 3.6s ease-in-out infinite; }
            .ac-node-2 { animation-duration: 4.8s; animation-delay: 1s; }
            .ac-node-3 { animation-duration: 5.6s; animation-delay: 2s; }
            .ac-mote { animation: ac-mote 6s ease-in-out infinite; }
            .ac-mote-2 { animation-duration: 7.5s; animation-delay: 1.5s; }
            .ac-mote-3 { animation-duration: 9s; animation-delay: 3s; }
          }
          @keyframes ac-spin { to { transform: rotate(360deg); } }
          @keyframes ac-spin-r { to { transform: rotate(-360deg); } }
          @keyframes ac-breathe {
            0%, 100% { opacity: 0.6; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.06); }
          }
          @keyframes ac-flow { to { stroke-dashoffset: -72; } }
          @keyframes ac-node {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 1; }
          }
          @keyframes ac-mote {
            0% { opacity: 0; transform: translateY(0); }
            30% { opacity: 0.7; }
            100% { opacity: 0; transform: translateY(-16px); }
          }
        `}</style>
      </svg>
    </div>
  );
};
