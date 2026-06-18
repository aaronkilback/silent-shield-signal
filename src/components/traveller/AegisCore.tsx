import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/**
 * AegisCore — a LIVING 3D Aegis presence for the traveller home (Slice D2.1, design-polished).
 *
 * Genuine WebGL 3D (react-three-fiber + three + postprocessing — all already Fortress deps),
 * but strictly VISUAL: a rotating neural sphere (points + proximity links), a bloom glow, a
 * chevron-shield emblem, a holo-floor reflection, and DECORATIVE orbiting particles (motion
 * only — NO agent names/labels, NO intel ticker, NO spoken line; those are operator/LLM/intel
 * and intentionally excluded from the traveller portal). NON-data-bearing, NON-agentic: NO
 * network, NO LLM, NO fetch, NO operator/signal/entity data, NO operational state. Reacts only
 * to a local `state` prop (idle/listening/processing/submitted) for spin/glow/tint. Honors
 * prefers-reduced-motion (no motion).
 */
export type AegisCoreState = "idle" | "listening" | "processing" | "submitted";

const IDLE = new THREE.Color("#5e9bff");
const DONE = new THREE.Color("#3ddc84");
const speedFor = (s: AegisCoreState, reduce: boolean) => (reduce ? 0 : s === "processing" ? 0.55 : s === "listening" ? 0.26 : 0.13);

function NeuralSphere({ stateRef, reduce }: { stateRef: React.MutableRefObject<AegisCoreState>; reduce: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ptsMat = useRef<THREE.PointsMaterial>(null);
  const lineMat = useRef<THREE.LineBasicMaterial>(null);
  const t = useRef(0);

  const { points, lines } = useMemo(() => {
    const N = 80;
    const v: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = Math.PI * (1 + Math.sqrt(5)) * i;
      v.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
    }
    const pts = new Float32Array(v.length * 3);
    v.forEach((p, i) => { pts[i * 3] = p.x; pts[i * 3 + 1] = p.y; pts[i * 3 + 2] = p.z; });
    const seg: number[] = [];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      if (v[i].distanceTo(v[j]) < 0.62) seg.push(v[i].x, v[i].y, v[i].z, v[j].x, v[j].y, v[j].z);
    }
    return { points: pts, lines: new Float32Array(seg) };
  }, []);

  useFrame((_, dt) => {
    const st = stateRef.current;
    if (group.current) { group.current.rotation.y += dt * speedFor(st, reduce); group.current.rotation.x = 0.32; }
    t.current += dt;
    const breathe = reduce ? 1 : 0.78 + 0.22 * Math.sin(t.current * (st === "processing" ? 4 : st === "listening" ? 2.4 : 1.4));
    const tint = st === "submitted" ? DONE : IDLE;
    if (ptsMat.current) { ptsMat.current.opacity = 0.55 + 0.35 * breathe; ptsMat.current.color.lerp(tint, 0.08); }
    if (lineMat.current) { lineMat.current.opacity = 0.10 + 0.06 * breathe; lineMat.current.color.lerp(tint, 0.08); }
  });

  return (
    <group ref={group}>
      <points>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[points, 3]} /></bufferGeometry>
        <pointsMaterial ref={ptsMat} color={IDLE} size={0.045} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <lineSegments>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[lines, 3]} /></bufferGeometry>
        <lineBasicMaterial ref={lineMat} color={IDLE} transparent opacity={0.13} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </group>
  );
}

// Holo-floor: faint concentric rings + reflection beneath the core (purely decorative).
function HoloFloor() {
  const radii = [0.55, 0.95, 1.35, 1.75];
  return (
    <group position={[0, -1.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {radii.map((r, i) => (
        <mesh key={i}>
          <ringGeometry args={[r - 0.012, r, 80]} />
          <meshBasicMaterial color="#5e9bff" transparent opacity={0.11 - i * 0.018} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}

// Decorative orbiting particles — motion only, NO labels, NO data, NO agent identity.
function OrbitParticles({ stateRef, reduce }: { stateRef: React.MutableRefObject<AegisCoreState>; reduce: boolean }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const seeds = useMemo(
    () => Array.from({ length: 5 }, (_, i) => ({ a: (i / 5) * Math.PI * 2, r: 1.35 + (i % 2) * 0.14, speed: 0.18 + (i % 3) * 0.05, squash: i % 2 ? 0.5 : 0.62 })),
    [],
  );
  useFrame((_, dt) => {
    const mult = reduce ? 0 : stateRef.current === "processing" ? 2 : stateRef.current === "listening" ? 1.4 : 1;
    seeds.forEach((s, i) => {
      s.a += dt * s.speed * mult;
      const m = refs.current[i];
      if (m) m.position.set(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r * 0.16, Math.sin(s.a) * s.r * s.squash);
    });
  });
  return (
    <>
      {seeds.map((_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }}>
          <sphereGeometry args={[0.032, 10, 10]} />
          <meshBasicMaterial color="#9fc8ff" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

export function AegisCore({ state = "idle", height = 320 }: { state?: AegisCoreState; height?: number }) {
  const stateRef = useRef<AegisCoreState>(state);
  stateRef.current = state;
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  return (
    <div className="flex flex-col items-center gap-1.5 select-none w-full">
      <div className="relative w-full" style={{ maxWidth: 460, height }}>
        <Canvas camera={{ position: [0, 0.25, 3.3], fov: 52 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} style={{ background: "transparent" }} frameloop={reduce ? "demand" : "always"}>
          <NeuralSphere stateRef={stateRef} reduce={reduce} />
          <HoloFloor />
          <OrbitParticles stateRef={stateRef} reduce={reduce} />
          <EffectComposer>
            <Bloom intensity={1.3} luminanceThreshold={0.04} luminanceSmoothing={0.3} mipmapBlur />
          </EffectComposer>
        </Canvas>
        {/* crisp chevron-shield emblem over the 3D core */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg width="84" height="84" viewBox="0 0 100 100" style={{ filter: "drop-shadow(0 0 14px rgba(94,155,255,.6))", transform: "translateY(-6%)" }}>
            <path d="M50 12 L82 26 L82 54 C82 76 64 88 50 92 C36 88 18 76 18 54 L18 26 Z" fill="rgba(20,40,80,.30)" stroke="#7ea8ff" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M34 64 L50 36 L66 64" fill="none" stroke="#dcebff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div className="font-mono text-xs tracking-[0.32em] text-[#8fb0ff]">AEGIS CORE</div>
      <div className="font-mono text-[10px] tracking-[0.34em] text-[#5e6c86]">
        {state === "listening" ? "LISTENING" : state === "processing" ? "WORKING" : state === "submitted" ? "RECEIVED" : "PERSONAL TRAVEL SUPPORT"}
      </div>
    </div>
  );
}
