/**
 * AegisCore — Slice 2A ("alive core" tuning pass).
 *
 * PURELY DECORATIVE living-intelligence atmosphere for the operator home: a
 * central Aegis shield seated in a breathing neural-sphere with orbiting
 * particles, soft arcs and a wide ambient energy field. It makes NO operational
 * claim — no data, no counts, no agent/node labels, no watching/monitoring/
 * scanning/on-station/investigating language, no live-state. Every dot/line/arc
 * is abstract atmosphere, not an agent.
 *
 * Safety contract:
 *  - Contained sibling with a fixed structural footprint (caller sets height).
 *    NOT a full-page/deep-space wrapper, NOT a page overlay. All absolute
 *    children live INSIDE this bounded, overflow-hidden section.
 *  - pointer-events-none + aria-hidden + select-none so it can never intercept
 *    clicks/focus from chat, voice, command/search or nav. No z-index escalation.
 *  - overflow-hidden so it cannot cause horizontal overflow.
 *  - Single theme colour via currentColor / hsl(var(--primary)); no external
 *    fonts, no @import. Animation CSS is component-scoped (one <style> block,
 *    aegis-* prefixed) — no global/index.css change.
 *  - ALL motion is wrapped in @media (prefers-reduced-motion: no-preference):
 *    reduced-motion users get a fully static (still premium) core.
 */
export const AegisCore = ({ className = "" }: { className?: string }) => {
  return (
    <div
      aria-hidden="true"
      className={`relative pointer-events-none select-none overflow-hidden flex items-center justify-center text-primary ${className}`}
    >
      {/* Wide ambient energy field — fills the section so the room feels occupied,
          fades to transparent at the edges so it blends with greeting + chat. */}
      <div
        className="absolute inset-0 aegis-breathe-slow"
        style={{
          background:
            "radial-gradient(58% 70% at 50% 46%, hsl(var(--primary) / 0.16), hsl(var(--primary) / 0.05) 42%, transparent 72%)",
        }}
      />

      <svg
        viewBox="0 0 240 240"
        preserveAspectRatio="xMidYMid meet"
        className="relative h-full w-auto max-w-full"
        fill="none"
        focusable="false"
      >
        <defs>
          <radialGradient id="aegisGlow" cx="50%" cy="52%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="45%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="aegisCoreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer energy field — slow breathe */}
        <circle
          cx="120" cy="128" r="58"
          fill="url(#aegisGlow)"
          className="aegis-breathe"
          style={{ transformBox: "view-box", transformOrigin: "120px 128px" }}
        />

        {/* Neural sphere — static base rings + a slowly rotating tilted set for depth */}
        <g stroke="currentColor" fill="none">
          <circle cx="120" cy="120" r="92" opacity="0.07" />
          <circle cx="120" cy="120" r="84" opacity="0.11" />
          <circle cx="120" cy="120" r="58" opacity="0.08" />
          <ellipse cx="120" cy="120" rx="84" ry="30" opacity="0.10" />
          <ellipse cx="120" cy="120" rx="30" ry="84" opacity="0.08" />
        </g>
        <g
          stroke="currentColor" fill="none"
          className="aegis-rot-cw"
          style={{ transformBox: "view-box", transformOrigin: "120px 120px" }}
        >
          <ellipse cx="120" cy="120" rx="84" ry="46" opacity="0.08" transform="rotate(32 120 120)" />
          <ellipse cx="120" cy="120" rx="84" ry="46" opacity="0.07" transform="rotate(-32 120 120)" />
          <ellipse cx="120" cy="120" rx="84" ry="64" opacity="0.05" />
        </g>

        {/* Soft neural arcs — gentle independent flicker */}
        <g stroke="currentColor" fill="none" strokeLinecap="round">
          <path d="M40 120 A 80 80 0 0 1 176 76" opacity="0.18" className="aegis-flicker-1" />
          <path d="M200 120 A 80 80 0 0 1 78 182" opacity="0.16" className="aegis-flicker-2" />
        </g>

        {/* Orbiting particles — two counter-rotating rings (parallax depth) */}
        <g
          fill="currentColor"
          className="aegis-rot-cw-slow"
          style={{ transformBox: "view-box", transformOrigin: "120px 120px" }}
        >
          <circle cx="120" cy="40" r="2.2" opacity="0.7" />
          <circle cx="188" cy="96" r="1.6" opacity="0.55" />
          <circle cx="72" cy="170" r="1.9" opacity="0.55" />
          <circle cx="196" cy="142" r="1.4" opacity="0.45" />
          <circle cx="60" cy="80" r="1.6" opacity="0.5" />
        </g>
        <g
          fill="currentColor"
          className="aegis-rot-ccw"
          style={{ transformBox: "view-box", transformOrigin: "120px 120px" }}
        >
          <circle cx="120" cy="198" r="1.9" opacity="0.6" />
          <circle cx="50" cy="120" r="1.6" opacity="0.5" />
          <circle cx="172" cy="58" r="1.5" opacity="0.5" />
          <circle cx="92" cy="186" r="1.3" opacity="0.4" />
          <circle cx="202" cy="112" r="1.4" opacity="0.45" />
        </g>

        {/* Inner core glow behind the shield — breathe */}
        <circle
          cx="120" cy="130" r="30"
          fill="url(#aegisCoreGlow)"
          className="aegis-breathe"
          style={{ transformBox: "view-box", transformOrigin: "120px 130px" }}
        />

        {/* Faint shield halo — breathes (keeps the crisp shield itself authoritative) */}
        <path
          d="M120 84 L144 95 L144 138 Q144 152 120 170 Q96 152 96 138 L96 95 Z"
          stroke="currentColor" strokeWidth="6" opacity="0.18" fill="none"
          className="aegis-breathe"
          style={{ transformBox: "view-box", transformOrigin: "120px 127px" }}
        />

        {/* Central Aegis shield (decorative brand mark — crisp, static) */}
        <path
          d="M120 84 L144 95 L144 138 Q144 152 120 170 Q96 152 96 138 L96 95 Z"
          stroke="currentColor" strokeWidth="2" opacity="0.9"
          fill="currentColor" fillOpacity="0.05"
        />
        {/* Upward chevron + stem inside the shield (abstract, not a letter/claim) */}
        <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95">
          <path d="M107 140 L120 114 L133 140" fill="none" />
          <line x1="120" y1="120" x2="120" y2="152" />
        </g>
      </svg>

      {/* Component-scoped animation. No global CSS, no @import. All motion gated
          behind prefers-reduced-motion: no-preference (reduced-motion = static). */}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .aegis-rot-cw { animation: aegis-spin-cw 80s linear infinite; }
          .aegis-rot-cw-slow { animation: aegis-spin-cw 120s linear infinite; }
          .aegis-rot-ccw { animation: aegis-spin-ccw 150s linear infinite; }
          .aegis-breathe { animation: aegis-breathe 7s ease-in-out infinite; }
          .aegis-breathe-slow { animation: aegis-breathe 12s ease-in-out infinite; }
          .aegis-flicker-1 { animation: aegis-flicker 6s ease-in-out infinite; }
          .aegis-flicker-2 { animation: aegis-flicker 7.5s ease-in-out infinite 1.4s; }
        }
        @keyframes aegis-spin-cw { to { transform: rotate(360deg); } }
        @keyframes aegis-spin-ccw { to { transform: rotate(-360deg); } }
        @keyframes aegis-breathe {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes aegis-flicker {
          0%, 100% { opacity: 0.10; }
          50% { opacity: 0.30; }
        }
      `}</style>
    </div>
  );
};
