import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/**
 * AegisCore — a LIVING 3D Aegis presence for the traveller home (Slice D2.1).
 *
 * Genuine WebGL 3D (react-three-fiber + three + postprocessing — all already Fortress deps),
 * but strictly VISUAL: a slowly-rotating 3D neural sphere (points + proximity links) with a
 * bloom glow and a crisp chevron-shield emblem. NON-data-bearing, NON-agentic: NO network, NO
 * LLM, NO fetch, NO operator/intel/signal/entity data, NO operational state. It only reacts to a
 * local `state` prop (idle/listening/processing/submitted) for spin speed, glow, and tint.
 * Honors prefers-reduced-motion (no spin). The full agent constellation is NOT built here.
 */
export type AegisCoreState = "idle" | "listening" | "processing" | "submitted";

const IDLE = new THREE.Color("#5e9bff");
const DONE = new THREE.Color("#3ddc84");

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
    const speed = reduce ? 0 : st === "processing" ? 0.55 : st === "listening" ? 0.26 : 0.13;
    if (group.current) { group.current.rotation.y += dt * speed; group.current.rotation.x = 0.32; }
    t.current += dt;
    const breathe = reduce ? 1 : 0.78 + 0.22 * Math.sin(t.current * (st === "processing" ? 4 : st === "listening" ? 2.4 : 1.4));
    const tint = st === "submitted" ? DONE : IDLE;
    if (ptsMat.current) { ptsMat.current.opacity = 0.55 + 0.35 * breathe; ptsMat.current.color.lerp(tint, 0.08); }
    if (lineMat.current) { lineMat.current.opacity = 0.10 + 0.06 * breathe; lineMat.current.color.lerp(tint, 0.08); }
  });

  return (
    <group ref={group}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[points, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={ptsMat} color={IDLE} size={0.045} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial ref={lineMat} color={IDLE} transparent opacity={0.13} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </group>
  );
}

export function AegisCore({ state = "idle", height = 260 }: { state?: AegisCoreState; height?: number }) {
  const stateRef = useRef<AegisCoreState>(state);
  stateRef.current = state;
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  return (
    <div className="flex flex-col items-center gap-1.5 select-none w-full">
      <div className="relative w-full" style={{ maxWidth: 380, height }}>
        <Canvas camera={{ position: [0, 0, 3.1], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} style={{ background: "transparent" }} frameloop={reduce ? "demand" : "always"}>
          <NeuralSphere stateRef={stateRef} reduce={reduce} />
          <EffectComposer>
            <Bloom intensity={1.25} luminanceThreshold={0.05} luminanceSmoothing={0.3} mipmapBlur />
          </EffectComposer>
        </Canvas>
        {/* crisp chevron-shield emblem over the 3D core */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg width="74" height="74" viewBox="0 0 100 100" style={{ filter: "drop-shadow(0 0 12px rgba(94,155,255,.6))" }}>
            <path d="M50 12 L82 26 L82 54 C82 76 64 88 50 92 C36 88 18 76 18 54 L18 26 Z"
              fill="rgba(20,40,80,.30)" stroke="#7ea8ff" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M34 64 L50 36 L66 64" fill="none" stroke="#dcebff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div className="font-mono text-xs tracking-[0.32em] text-[#8fb0ff]">AEGIS CORE</div>
      <div className="font-mono text-[10px] tracking-[0.34em] text-[#5e6c86]">
        {state === "listening" ? "LISTENING" : state === "processing" ? "WORKING" : state === "submitted" ? "RECEIVED" : "SENTIENT INTELLIGENCE"}
      </div>
    </div>
  );
}
