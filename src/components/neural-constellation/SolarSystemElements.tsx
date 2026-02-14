import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ─── Milky Way Band ─────────────────────────────────────────────
// A dense ribbon of tiny stars forming a galactic plane across the sky
export function MilkyWayBand() {
  const ref = useRef<THREE.Points>(null);
  const count = 6000;

  const { positions, colors, sizes } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Distribute along a tilted band
      const angle = Math.random() * Math.PI * 2;
      const radius = 200 + Math.random() * 300;
      const bandWidth = (Math.random() - 0.5) * 40 * (1 - Math.abs(Math.random() - 0.5)); // concentrated center
      const tilt = 0.4; // ~23° tilt

      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = Math.sin(angle) * radius * Math.sin(tilt) + bandWidth;
      pos[i * 3 + 2] = Math.sin(angle) * radius * Math.cos(tilt) + (Math.random() - 0.5) * 15;

      // Warm blue-white to gold tones
      const warmth = Math.random();
      if (warmth > 0.7) {
        col[i * 3] = 0.9 + Math.random() * 0.1;
        col[i * 3 + 1] = 0.85 + Math.random() * 0.1;
        col[i * 3 + 2] = 0.6 + Math.random() * 0.2;
      } else {
        col[i * 3] = 0.7 + Math.random() * 0.3;
        col[i * 3 + 1] = 0.75 + Math.random() * 0.25;
        col[i * 3 + 2] = 0.85 + Math.random() * 0.15;
      }

      sz[i] = 0.1 + Math.random() * 0.25;
    }
    return { positions: pos, colors: col, sizes: sz };
  }, []);

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-size" count={count} array={sizes} itemSize={1} />
      </bufferGeometry>
      <pointsMaterial size={0.15} vertexColors transparent opacity={0.4} sizeAttenuation depthWrite={false} />
    </points>
  );
}

// ─── Distant Planet ─────────────────────────────────────────────
function DistantPlanet({
  position,
  radius,
  color,
  emissiveIntensity = 0,
  rings,
}: {
  position: [number, number, number];
  radius: number;
  color: string;
  emissiveIntensity?: number;
  rings?: { innerRadius: number; outerRadius: number; color: string };
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.02;
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshStandardMaterial
          color={color}
          roughness={0.8}
          metalness={0.1}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>
      {rings && (
        <mesh rotation={[Math.PI * 0.45, 0.1, 0]}>
          <ringGeometry args={[rings.innerRadius, rings.outerRadius, 64]} />
          <meshStandardMaterial
            color={rings.color}
            side={THREE.DoubleSide}
            transparent
            opacity={0.5}
            roughness={0.9}
          />
        </mesh>
      )}
    </group>
  );
}

export function PlanetParade() {
  return (
    <>
      {/* Mars — reddish, distant */}
      <DistantPlanet position={[160, 30, -120]} radius={1.5} color="#c1440e" emissiveIntensity={0.05} />
      {/* Jupiter — large gas giant */}
      <DistantPlanet position={[-200, -20, 150]} radius={5} color="#c8a45c" emissiveIntensity={0.02} />
      {/* Saturn — with rings */}
      <DistantPlanet
        position={[250, 50, 180]}
        radius={4}
        color="#e8d5a3"
        emissiveIntensity={0.02}
        rings={{ innerRadius: 5.5, outerRadius: 9, color: "#d4c49a" }}
      />
    </>
  );
}

// ─── Asteroid Belt ──────────────────────────────────────────────
// A ring of small drifting rocks between inner constellation and outer space
export function AsteroidBelt() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 300;

  const { matrices, scales } = useMemo(() => {
    const mat: THREE.Matrix4[] = [];
    const sc: number[] = [];
    const dummy = new THREE.Matrix4();

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const radius = 80 + Math.random() * 25;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = (Math.random() - 0.5) * 8;
      const scale = 0.15 + Math.random() * 0.5;

      dummy.makeTranslation(x, y, z);
      dummy.multiply(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      ));
      dummy.multiply(new THREE.Matrix4().makeScale(scale, scale * (0.5 + Math.random() * 0.5), scale));

      mat.push(dummy.clone());
      sc.push(scale);
    }
    return { matrices: mat, scales: sc };
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() * 0.005;
    const rot = new THREE.Matrix4().makeRotationY(t);
    const dummy = new THREE.Matrix4();

    for (let i = 0; i < count; i++) {
      dummy.copy(rot).multiply(matrices[i]);
      ref.current.setMatrixAt(i, dummy);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#6b6b6b" roughness={1} metalness={0.2} />
    </instancedMesh>
  );
}

// ─── Comets ─────────────────────────────────────────────────────
// Occasional bright comets with glowing tails streaking through the scene
export function Comets() {
  const groupRef = useRef<THREE.Group>(null);
  const cometCount = 3;

  const comets = useRef<{
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
    active: boolean;
    tailPositions: THREE.Vector3[];
  }[]>([]);

  useMemo(() => {
    comets.current = Array.from({ length: cometCount }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 0,
      active: false,
      tailPositions: Array.from({ length: 20 }, () => new THREE.Vector3()),
    }));
  }, []);

  useFrame((_, delta) => {
    comets.current.forEach((comet) => {
      if (!comet.active) {
        // Very rare spawn — roughly one every 30 seconds
        if (Math.random() < 0.0005) {
          const side = Math.random() > 0.5 ? 1 : -1;
          comet.pos.set(
            side * (150 + Math.random() * 100),
            (Math.random() - 0.3) * 80,
            (Math.random() - 0.5) * 200
          );
          comet.vel.set(
            -side * (0.8 + Math.random() * 0.5),
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.4
          );
          comet.maxLife = 8 + Math.random() * 6;
          comet.life = 0;
          comet.active = true;
          comet.tailPositions.forEach((tp) => tp.copy(comet.pos));
        }
        return;
      }

      comet.life += delta;
      if (comet.life > comet.maxLife) {
        comet.active = false;
        return;
      }

      comet.pos.addScaledVector(comet.vel, delta * 30);

      // Shift tail
      for (let j = comet.tailPositions.length - 1; j > 0; j--) {
        comet.tailPositions[j].copy(comet.tailPositions[j - 1]);
      }
      comet.tailPositions[0].copy(comet.pos);
    });
  });

  return (
    <group ref={groupRef}>
      {comets.current.map((comet, i) => (
        <CometVisual key={i} comet={comet} />
      ))}
    </group>
  );
}

function CometVisual({ comet }: {
  comet: { pos: THREE.Vector3; active: boolean; life: number; maxLife: number; tailPositions: THREE.Vector3[] }
}) {
  const headRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const tailRef = useRef<THREE.Line>(null);

  const tailLine = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({ color: "#aaddff", transparent: true, opacity: 0.3 });
    return new THREE.Line(geom, mat);
  }, []);

  useFrame(() => {
    if (!comet.active) {
      if (headRef.current) headRef.current.visible = false;
      if (glowRef.current) glowRef.current.visible = false;
      tailLine.visible = false;
      return;
    }

    if (headRef.current) {
      headRef.current.visible = true;
      headRef.current.position.copy(comet.pos);
      const fade = 1 - comet.life / comet.maxLife;
      (headRef.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
    }
    if (glowRef.current) {
      glowRef.current.visible = true;
      glowRef.current.position.copy(comet.pos);
    }

    tailLine.visible = true;
    const positions = new Float32Array(comet.tailPositions.length * 3);
    comet.tailPositions.forEach((tp, j) => {
      positions[j * 3] = tp.x;
      positions[j * 3 + 1] = tp.y;
      positions[j * 3 + 2] = tp.z;
    });
    tailLine.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  });

  return (
    <>
      <mesh ref={headRef}>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial color="#e0f0ff" transparent opacity={0.9} />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[1.2, 8, 8]} />
        <meshBasicMaterial color="#88ccff" transparent opacity={0.15} side={THREE.BackSide} />
      </mesh>
      <primitive object={tailLine} />
    </>
  );
}
