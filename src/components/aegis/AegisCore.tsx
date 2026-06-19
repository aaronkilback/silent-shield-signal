/**
 * AegisCore — Slice 2A.
 *
 * PURELY DECORATIVE brand atmosphere for the operator home: a central Aegis
 * shield inside a faint neural-sphere. It makes NO operational claim — no data,
 * no counts, no agent labels, no "watching/monitoring/on-station" language, no
 * live-state. The dots/lines are abstract atmosphere, not agents.
 *
 * Safety contract (Slice 2A):
 *  - Contained sibling with a fixed structural footprint (caller sets height).
 *    NOT a full-page/deep-space wrapper, NOT an overlay.
 *  - pointer-events-none + aria-hidden + select-none so it can never intercept
 *    clicks/focus from chat, voice, or the command/search palette.
 *  - overflow-hidden so it cannot cause horizontal overflow.
 *  - Single theme colour via currentColor (set text-primary on the root); no
 *    external fonts, no @import, no global CSS.
 *  - Motion only under motion-safe (respects prefers-reduced-motion).
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
        className="h-full w-auto max-w-full"
        fill="none"
        focusable="false"
      >
        <defs>
          <radialGradient id="aegisGlow" cx="50%" cy="52%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.10" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Faint neural sphere — concentric + tilted ellipses suggesting a globe */}
        <g stroke="currentColor" fill="none">
          <circle cx="120" cy="120" r="84" opacity="0.10" />
          <circle cx="120" cy="120" r="60" opacity="0.08" />
          <ellipse cx="120" cy="120" rx="84" ry="30" opacity="0.10" />
          <ellipse cx="120" cy="120" rx="30" ry="84" opacity="0.08" />
          <ellipse cx="120" cy="120" rx="84" ry="46" opacity="0.07" transform="rotate(32 120 120)" />
          <ellipse cx="120" cy="120" rx="84" ry="46" opacity="0.07" transform="rotate(-32 120 120)" />
        </g>

        {/* Abstract atmosphere: decorative nodes + faint links (NOT agents) */}
        <g stroke="currentColor" opacity="0.18">
          <line x1="58" y1="74" x2="120" y2="50" />
          <line x1="182" y1="84" x2="120" y2="50" />
          <line x1="70" y1="170" x2="120" y2="190" />
          <line x1="170" y1="166" x2="120" y2="190" />
          <line x1="40" y1="120" x2="58" y2="74" />
          <line x1="200" y1="120" x2="182" y2="84" />
        </g>
        <g fill="currentColor">
          <circle cx="58" cy="74" r="2.2" opacity="0.55" />
          <circle cx="182" cy="84" r="2.2" opacity="0.55" />
          <circle cx="120" cy="50" r="1.8" opacity="0.45" />
          <circle cx="40" cy="120" r="1.6" opacity="0.40" />
          <circle cx="200" cy="120" r="1.6" opacity="0.40" />
          <circle cx="70" cy="170" r="2.0" opacity="0.45" />
          <circle cx="170" cy="166" r="2.0" opacity="0.45" />
          <circle cx="120" cy="190" r="1.6" opacity="0.40" />
          <circle cx="96" cy="96" r="1.2" opacity="0.30" />
          <circle cx="150" cy="104" r="1.2" opacity="0.30" />
        </g>

        {/* Soft core glow — the only animated element, gated by motion-safe */}
        <circle
          cx="120"
          cy="128"
          r="56"
          fill="url(#aegisGlow)"
          className="motion-safe:animate-pulse"
        />

        {/* Central Aegis shield (decorative brand mark) */}
        <path
          d="M120 84 L144 95 L144 138 Q144 152 120 170 Q96 152 96 138 L96 95 Z"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.85"
          fill="currentColor"
          fillOpacity="0.04"
        />
        {/* Upward chevron + stem inside the shield (abstract, not a letter/claim) */}
        <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95">
          <path d="M107 140 L120 114 L133 140" fill="none" />
          <line x1="120" y1="120" x2="120" y2="152" />
        </g>
      </svg>
    </div>
  );
};
