import { useEffect, useRef } from "react";

/**
 * AegisCoreCanvas — Slice 2A "Aegis Magical Core" (Canvas 2D).
 *
 * A PURELY DECORATIVE living-intelligence core, ported from the v9 design handoff's
 * procedural Canvas 2D engine (`initCanvas()`), trimmed to the abstract scene only.
 *
 * INCLUDED (decorative, data-free): drifting nebula, twinkling starfield, ground
 * reflection + orbit ellipses, vertical light beam, wireframe great-circle rings, a
 * 110-node Fibonacci node-sphere with a link graph, traveling synapses, a luminous
 * shield emblem, and a breathing core halo — all drawn with additive ('lighter')
 * compositing so it reads as light. Auto-spin + subtle mouse parallax.
 *
 * INTENTIONALLY EXCLUDED for honesty (no fake operational content): the v9 agent
 * comets + labels (SENTINEL/HUNTER/ORACLE/WARDEN/ARCHIVIST), the alert/"worries"
 * hue-morph, status tickers, stats, and the scripted conversation. No data, no
 * counts, no labels, no operational language. Those wait for real-data slices.
 *
 * Safety / perf:
 *  - Canvas 2D only (no WebGL, no deps). aria-hidden; root is pointer-events-none so
 *    it can never intercept chat/voice/command — parallax uses a passive read-only
 *    window listener (no pointer capture; drag-to-rotate omitted to keep the backdrop
 *    non-interactive).
 *  - DPR capped at 2; lighter particle/star/synapse budget below md.
 *  - prefers-reduced-motion => a single STATIC frame (no rAF loop).
 *  - rAF cancelled + all listeners/observers removed on unmount; loop pauses when the
 *    element scrolls out of view or the tab is hidden.
 */
export const AegisCoreCanvas = ({ className = "" }: { className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const TAU = Math.PI * 2;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.innerWidth < 768;

    // Nocturne palette (from v9 handoff). Hardcoded design hues — no alert/threat state.
    const HUE = 212;
    const ACCENTS = [38, 150, 320, 8, 190];
    const NEBULA_HUES = [226, 274, 198];
    const DOT_LIGHT = 72;
    const SYN_HUE = ACCENTS[4]; // ~190 cyan

    // Budgets (lighter on mobile)
    const N = small ? 64 : 110;
    const STAR_COUNT = small ? 90 : 170;
    const SYN_CAP = small ? 10 : 20;

    // ---- Build geometry (Fibonacci sphere + links + rings + stars + nebula) ----
    const dots: Array<{ x: number; y: number; z: number; phase: number; sz: number; accIdx: number; acc: boolean; hub: boolean }> = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * 2.399963;
      const isAcc = Math.random() < 0.08;
      dots.push({
        x: Math.cos(th) * rad, y, z: Math.sin(th) * rad,
        phase: Math.random() * TAU, sz: 0.8 + Math.random() * 0.9,
        accIdx: (Math.random() * 5) | 0, acc: isAcc, hub: !isAcc && Math.random() < 0.14,
      });
    }
    const links: Array<[number, number]> = [];
    for (let i = 0; i < dots.length; i++) {
      let c = 0;
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y, dz = dots[i].z - dots[j].z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.5) { links.push([i, j]); if (++c > 4) break; }
      }
    }
    const rings: Array<Array<{ x: number; y: number; z: number }>> = [];
    const RS = 48;
    [0, Math.PI / 3, (2 * Math.PI) / 3].forEach((phi) => {
      const p = [];
      for (let k = 0; k < RS; k++) { const u = (k / RS) * TAU; p.push({ x: Math.cos(u) * Math.cos(phi), y: Math.sin(u), z: Math.cos(u) * Math.sin(phi) }); }
      rings.push(p);
    });
    [-0.55, 0, 0.55].forEach((cc) => {
      const r = Math.sqrt(Math.max(0, 1 - cc * cc)), p = [];
      for (let k = 0; k < RS; k++) { const u = (k / RS) * TAU; p.push({ x: Math.cos(u) * r, y: cc, z: Math.sin(u) * r }); }
      rings.push(p);
    });
    const stars: Array<{ x: number; y: number; b: number; tw: number; sp: number; sz: number; warm: boolean }> = [];
    for (let i = 0; i < STAR_COUNT; i++) stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, b: Math.random() * 0.7 + 0.2, tw: Math.random() * TAU, sp: 0.6 + Math.random() * 1.6, sz: Math.random() * 1.1 + 0.3, warm: Math.random() < 0.12 });
    const nebula = [{ idx: 0, ox: -0.32, oy: -0.22 }, { idx: 1, ox: 0.34, oy: 0.18 }, { idx: 2, ox: 0.08, oy: 0.34 }].map((n) => ({ ...n, ph: Math.random() * TAU }));
    const synapses: Array<{ li: number; sp: number; off: number }> = [];
    for (let i = 0; i < links.length && synapses.length < SYN_CAP; i++) if (Math.random() < 0.4) synapses.push({ li: i, sp: 0.12 + Math.random() * 0.4, off: Math.random() });

    // ---- View state ----
    let W = 0, H = 0, DPR = 1;
    let ry = 0.3, rx = 0.42;
    let ptx = 0, pty = 0, pox = 0, poy = 0;
    let raf = 0;
    let visible = true;

    const resize = () => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      el.width = Math.round(W * DPR); el.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (reduce) draw(0); // keep static render crisp on resize
    };

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      ptx = (e.clientX - r.left) / r.width - 0.5;
      pty = (e.clientY - r.top) / r.height - 0.5;
    };

    function shield(cx: number, cy: number, s: number, t: number, glow: string, edge: { fill0: string; fill1: string; stroke: (tt: number) => string; chevSoft: string; chevTip: string }) {
      const w = s * 0.3, top = -s * 0.4, sh = -s * 0.16, mid = s * 0.1, bot = s * 0.46;
      ctx.save();
      ctx.shadowBlur = 16; ctx.shadowColor = glow;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy + top); ctx.lineTo(cx + w, cy + top); ctx.lineTo(cx + w, cy + sh);
      ctx.lineTo(cx + w * 0.82, cy + mid); ctx.lineTo(cx, cy + bot); ctx.lineTo(cx - w * 0.82, cy + mid); ctx.lineTo(cx - w, cy + sh); ctx.closePath();
      const gg = ctx.createLinearGradient(cx, cy + top, cx, cy + bot);
      gg.addColorStop(0, edge.fill0); gg.addColorStop(1, edge.fill1);
      ctx.fillStyle = gg; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = edge.stroke(t); ctx.stroke();
      const _ay = cy + top + s * 0.13, _ey = cy + mid * 0.55, _lx = cx - w * 0.48, _rx = cx + w * 0.48;
      const drawChevron = (lw: number, stroke: string | CanvasGradient, blur: number, col: string) => {
        ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.shadowBlur = blur; ctx.shadowColor = col; ctx.lineWidth = lw; ctx.strokeStyle = stroke;
        ctx.beginPath(); ctx.moveTo(_lx, _ey); ctx.lineTo(cx, _ay); ctx.lineTo(_rx, _ey); ctx.stroke();
        ctx.restore();
      };
      drawChevron(6, edge.chevSoft, 18, glow);
      const _ag = ctx.createLinearGradient(cx, _ay, cx, _ey); _ag.addColorStop(0, "#ffffff"); _ag.addColorStop(1, edge.chevTip);
      drawChevron(2.4, _ag, 7, glow);
      ctx.restore();
    }

    const t0 = typeof performance !== "undefined" ? performance.now() : 0;

    function draw(now: number) {
      if (!W || !H) return;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);

      const cx = W * 0.5, scy = H * 0.43, R = Math.min(W * 0.32, H * 0.4), fy = H * 0.85;

      if (!reduce) { ry += 0.0038; }
      pox += (ptx - pox) * 0.06; poy += (pty - poy) * 0.06;
      const yaw = ry + pox * 0.5, pitch = rx + poy * 0.35;
      const cY = Math.cos(yaw), sY = Math.sin(yaw), cX = Math.cos(pitch), sX = Math.sin(pitch);
      const proj = (p: { x: number; y: number; z: number }): [number, number, number] => {
        const x = p.x * cY - p.z * sY, z = p.x * sY + p.z * cY, y = p.y;
        const y2 = y * cX - z * sX, z2 = y * sX + z * cX;
        return [cx + x * R, scy + y2 * R, (z2 + 1) / 2];
      };

      ctx.globalCompositeOperation = "lighter";

      for (const n of nebula) {
        const nh = NEBULA_HUES[n.idx % NEBULA_HUES.length];
        const nx = cx + (n.ox + Math.sin(t * 0.05 + n.ph) * 0.05) * W * 0.45;
        const ny = scy + (n.oy + Math.cos(t * 0.04 + n.ph) * 0.05) * H * 0.4;
        const nr = R * 2.2;
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
        g.addColorStop(0, `hsla(${nh},72%,56%,0.10)`); g.addColorStop(0.55, `hsla(${nh},72%,52%,0.03)`); g.addColorStop(1, `hsla(${nh},72%,52%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx, ny, nr, 0, TAU); ctx.fill();
      }
      for (const s of stars) {
        const sx = (s.x * 0.5 + 0.5) * W, sy = (s.y * 0.5 + 0.5) * H;
        const a = s.b * (0.35 + 0.65 * Math.sin(t * s.sp + s.tw));
        if (a <= 0) continue;
        ctx.fillStyle = s.warm ? `rgba(255,212,170,${a})` : `rgba(198,220,255,${a})`;
        ctx.beginPath(); ctx.arc(sx, sy, s.sz, 0, TAU); ctx.fill();
      }

      for (let k = 1; k <= 6; k++) { const rx2 = R * (0.5 + k * 0.62), ry2 = rx2 * 0.17, a = 0.15 * (1 - k / 7.5); ctx.strokeStyle = `hsla(${HUE},70%,60%,${a})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, fy, rx2, ry2, 0, 0, TAU); ctx.stroke(); }
      const fb = ctx.createRadialGradient(cx, fy, 0, cx, fy, R * 1.1); fb.addColorStop(0, `hsla(${HUE},85%,72%,0.42)`); fb.addColorStop(0.5, `hsla(${HUE},85%,60%,0.10)`); fb.addColorStop(1, `hsla(${HUE},85%,60%,0)`); ctx.fillStyle = fb; ctx.beginPath(); ctx.ellipse(cx, fy, R * 1.1, R * 0.22, 0, 0, TAU); ctx.fill();
      const rf = ctx.createRadialGradient(cx, fy + R * 0.22, 0, cx, fy + R * 0.22, R * 0.95); rf.addColorStop(0, `hsla(${HUE},80%,62%,0.18)`); rf.addColorStop(0.6, `hsla(${HUE},80%,62%,0.05)`); rf.addColorStop(1, `hsla(${HUE},80%,62%,0)`); ctx.fillStyle = rf; ctx.beginPath(); ctx.ellipse(cx, fy + R * 0.22, R * 0.72, R * 0.52, 0, 0, TAU); ctx.fill();

      const beam = ctx.createLinearGradient(cx, 0, cx, fy); beam.addColorStop(0, `hsla(${HUE},90%,78%,0)`); beam.addColorStop(0.45, `hsla(${HUE},90%,78%,0.5)`); beam.addColorStop(0.55, `hsla(${HUE},90%,78%,0.5)`); beam.addColorStop(1, `hsla(${HUE},90%,78%,0)`); ctx.fillStyle = beam; ctx.fillRect(cx - 1.2, 0, 2.4, fy);

      for (const ring of rings) { ctx.beginPath(); let st = false; for (let k = 0; k <= ring.length; k++) { const [x, y] = proj(ring[k % ring.length]); if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y); } ctx.strokeStyle = `hsla(${HUE},75%,62%,0.13)`; ctx.lineWidth = 0.8; ctx.stroke(); }

      ctx.lineWidth = 0.6;
      for (const [i, j] of links) { const a = proj(dots[i]), b = proj(dots[j]); const depth = (a[2] + b[2]) / 2; const tw = 0.4 + 0.6 * Math.sin(t * 1.1 + dots[i].phase); ctx.strokeStyle = `hsla(${HUE},80%,68%,${(0.05 + depth * 0.22) * tw})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }

      for (const sObj of synapses) {
        const [i, j] = links[sObj.li]; if (i == null) continue;
        const a = proj(dots[i]), b = proj(dots[j]);
        const depth = (a[2] + b[2]) / 2;
        const f = (t * sObj.sp + sObj.off) % 1;
        const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        const al = 0.4 + depth * 0.6;
        ctx.shadowBlur = 10; ctx.shadowColor = `hsla(${SYN_HUE},100%,78%,0.95)`;
        ctx.fillStyle = `hsla(${SYN_HUE},100%,88%,${al})`;
        ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
      }
      ctx.shadowBlur = 0;

      for (const p of dots) {
        const [x, y, depth] = proj(p);
        const tw = 0.4 + 0.6 * Math.sin(t * 1.5 + p.phase);
        const baseA = (0.2 + depth * 0.8) * (0.5 + 0.5 * tw);
        const hue = p.acc ? ACCENTS[p.accIdx % ACCENTS.length] : HUE;
        const light = p.acc ? DOT_LIGHT - 8 : DOT_LIGHT;
        ctx.shadowBlur = p.hub ? 13 : p.acc ? 10 : 6; ctx.shadowColor = `hsla(${hue},90%,68%,0.9)`;
        ctx.fillStyle = `hsla(${hue},92%,${light + tw * 14}%,${p.acc ? Math.min(1, baseA + 0.25) : p.hub ? Math.min(1, baseA + 0.15) : baseA})`;
        ctx.beginPath(); ctx.arc(x, y, p.sz * (0.8 + depth * 0.8) * (p.acc ? 1.5 : 1) * (p.hub ? 1.8 : 1), 0, TAU); ctx.fill();
      }
      ctx.shadowBlur = 0;

      const pulse = 0.5 + 0.5 * Math.sin(t * 1.2);
      const cr = R * (0.5 + 0.04 * pulse);
      const halo = ctx.createRadialGradient(cx, scy, 0, cx, scy, cr); halo.addColorStop(0, `hsla(${HUE},85%,80%,0.5)`); halo.addColorStop(0.4, `hsla(${HUE},85%,62%,0.16)`); halo.addColorStop(1, `hsla(${HUE},85%,55%,0)`); ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, scy, cr, 0, TAU); ctx.fill();
      const sl = HUE;
      shield(cx, scy, R * 0.92, t, `hsla(${sl},90%,68%,0.9)`, {
        fill0: `hsla(${sl},80%,72%,0.28)`, fill1: `hsla(${sl},85%,55%,0.12)`,
        stroke: (tt) => `hsla(${sl},70%,90%,${0.85 + 0.15 * Math.sin(tt * 2)})`,
        chevSoft: `hsla(${sl},85%,62%,0.30)`, chevTip: `hsla(${sl},85%,78%,1)`,
      });

      ctx.globalCompositeOperation = "source-over";
    }

    const frame = (now: number) => {
      if (visible && !document.hidden) {
        try { draw(now); } catch { /* keep loop alive */ }
      }
      raf = requestAnimationFrame(frame);
    };

    // Observers / listeners
    let ro: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true } as AddEventListenerOptions);
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(() => resize()); ro.observe(el); }
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; }, { threshold: 0 });
      io.observe(el);
    }

    resize();
    if (reduce) {
      draw(t0); // single static frame; no rAF loop
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove as EventListener);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
    };
  }, []);

  return (
    <div aria-hidden="true" className={`pointer-events-none select-none overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
};
