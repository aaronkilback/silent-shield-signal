import { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";

interface AgentNode {
  id: string;
  callSign: string;
  codename: string;
  specialty: string;
  color: string;
  position: [number, number, number];
  tier: "primary" | "secondary" | "support";
}

interface ConstellationSceneProps {
  agents: AgentNode[];
  onNodeClick?: (agent: AgentNode) => void;
  isExecutiveMode: boolean;
  neutralizedCount?: number;
}

// Deep space starfield — varied brightness, blue/white/amber tones
function DeepSpaceField({ neutralizedCount = 0 }: { neutralizedCount: number }) {
  const ref = useRef<THREE.Points>(null);
  const totalStars = 4000;

  const { positions, colors, sizes } = useMemo(() => {
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);

    // Stars that can be dimmed based on neutralized threats
    const dimmableCount = Math.min(neutralizedCount * 8, totalStars * 0.4);

    for (let i = 0; i < totalStars; i++) {
      // Distribute in a sphere shell for depth
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 30 + Math.random() * 70;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);

      // Color palette: mostly cool blue-white, some warm amber/orange
      const isDimmed = i < dimmableCount;
      const colorRoll = Math.random();

      if (isDimmed) {
        // Dimmed stars — very faint grey
        const fade = 0.05 + Math.random() * 0.08;
        col[i * 3] = fade;
        col[i * 3 + 1] = fade;
        col[i * 3 + 2] = fade;
        sz[i] = 0.02 + Math.random() * 0.05;
      } else if (colorRoll < 0.5) {
        // Cool blue-white
        col[i * 3] = 0.7 + Math.random() * 0.3;
        col[i * 3 + 1] = 0.8 + Math.random() * 0.2;
        col[i * 3 + 2] = 1.0;
        sz[i] = 0.08 + Math.random() * 0.25;
      } else if (colorRoll < 0.8) {
        // Pure white bright
        const b = 0.85 + Math.random() * 0.15;
        col[i * 3] = b;
        col[i * 3 + 1] = b;
        col[i * 3 + 2] = b;
        sz[i] = 0.06 + Math.random() * 0.2;
      } else {
        // Warm amber/orange
        col[i * 3] = 0.95 + Math.random() * 0.05;
        col[i * 3 + 1] = 0.5 + Math.random() * 0.3;
        col[i * 3 + 2] = 0.1 + Math.random() * 0.15;
        sz[i] = 0.1 + Math.random() * 0.35;
      }
    }
    return { positions: pos, colors: col, sizes: sz };
  }, [neutralizedCount]);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.003;
      ref.current.rotation.x += delta * 0.001;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={totalStars} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={totalStars} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.2} vertexColors transparent opacity={0.9} sizeAttenuation />
    </points>
  );
}

// Nebula glow clouds — soft volumetric blobs
function NebulaCloud({ position, color, scale = 3 }: { position: [number, number, number]; color: string; scale?: number }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.z += delta * 0.01;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[scale, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.04} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Agent node with cinematic glow
function AgentSphere({ agent, onClick }: { agent: AgentNode; onClick?: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(Math.random() * Math.PI * 2);

  const color = new THREE.Color(agent.color);
  const size = agent.tier === "primary" ? 0.5 : agent.tier === "secondary" ? 0.35 : 0.22;

  useFrame((_, delta) => {
    pulseRef.current += delta * 1.8;
    const pulse = Math.sin(pulseRef.current);

    if (meshRef.current) {
      meshRef.current.scale.setScalar(1 + pulse * 0.06);
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(2.2 + pulse * 0.4);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.15 + pulse * 0.05;
    }
    if (outerRef.current) {
      outerRef.current.scale.setScalar(3.5 + pulse * 0.6);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = 0.04 + pulse * 0.02;
    }
  });

  return (
    <group position={agent.position}>
      {/* Outer atmospheric glow */}
      <mesh ref={outerRef} onClick={onClick}>
        <sphereGeometry args={[size, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.04} />
      </mesh>
      {/* Mid glow */}
      <mesh ref={glowRef} onClick={onClick}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
      {/* Bright core */}
      <mesh ref={meshRef} onClick={onClick}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.8}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
      <pointLight color={agent.color} intensity={agent.tier === "primary" ? 1.2 : 0.5} distance={agent.tier === "primary" ? 8 : 4} />
    </group>
  );
}

// Connection lines with color based on agent colors
function ConnectionLines({ agents }: { agents: AgentNode[] }) {
  const connections = useMemo(() => {
    const conns: [number, number][] = [];
    const primaryIndices = agents.map((a, i) => (a.tier === "primary" ? i : -1)).filter((i) => i >= 0);

    for (let i = 0; i < primaryIndices.length; i++) {
      for (let j = i + 1; j < primaryIndices.length; j++) {
        conns.push([primaryIndices[i], primaryIndices[j]]);
      }
    }

    agents.forEach((agent, idx) => {
      if (agent.tier !== "primary") {
        let nearest = primaryIndices[0];
        let minDist = Infinity;
        primaryIndices.forEach((pi) => {
          const dx = agent.position[0] - agents[pi].position[0];
          const dy = agent.position[1] - agents[pi].position[1];
          const dz = agent.position[2] - agents[pi].position[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < minDist) { minDist = dist; nearest = pi; }
        });
        conns.push([idx, nearest]);
      }
    });

    return conns;
  }, [agents]);

  return (
    <group>
      {connections.map(([a, b], idx) => {
        const points = [new THREE.Vector3(...agents[a].position), new THREE.Vector3(...agents[b].position)];
        const isPrimary = agents[a].tier === "primary" && agents[b].tier === "primary";
        // Blend colors of connected nodes
        const lineColor = isPrimary ? "#3b82f6" : agents[a].color;
        return (
          <Line
            key={idx}
            points={points}
            color={lineColor}
            transparent
            opacity={isPrimary ? 0.3 : 0.12}
            lineWidth={isPrimary ? 1.5 : 0.8}
          />
        );
      })}
    </group>
  );
}

// Signal particles — cyan and orange streaks
function SignalParticles({ agents }: { agents: AgentNode[] }) {
  const particleCount = 50;
  const ref = useRef<THREE.Points>(null);
  const velocities = useRef(new Float32Array(particleCount));
  const targets = useRef<number[]>([]);
  const sources = useRef<number[]>([]);

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    const primaryIndices = agents.map((a, i) => (a.tier === "primary" ? i : -1)).filter((i) => i >= 0);

    for (let i = 0; i < particleCount; i++) {
      const srcIdx = Math.floor(Math.random() * agents.length);
      const tgtIdx = primaryIndices[Math.floor(Math.random() * primaryIndices.length)];
      sources.current[i] = srcIdx;
      targets.current[i] = tgtIdx;
      velocities.current[i] = Math.random();

      const src = agents[srcIdx].position;
      const tgt = agents[tgtIdx].position;
      const t = velocities.current[i];
      pos[i * 3] = src[0] + (tgt[0] - src[0]) * t;
      pos[i * 3 + 1] = src[1] + (tgt[1] - src[1]) * t;
      pos[i * 3 + 2] = src[2] + (tgt[2] - src[2]) * t;

      // Alternate cyan and orange particles
      if (Math.random() > 0.4) {
        col[i * 3] = 0.13; col[i * 3 + 1] = 0.83; col[i * 3 + 2] = 0.93;
      } else {
        col[i * 3] = 0.98; col[i * 3 + 1] = 0.45; col[i * 3 + 2] = 0.09;
      }
    }
    return { positions: pos, colors: col };
  }, [agents]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const posArr = ref.current.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      velocities.current[i] += delta * (0.12 + Math.random() * 0.08);

      if (velocities.current[i] >= 1) {
        velocities.current[i] = 0;
        sources.current[i] = targets.current[i];
        targets.current[i] = Math.floor(Math.random() * agents.length);
      }

      const src = agents[sources.current[i]]?.position || [0, 0, 0];
      const tgt = agents[targets.current[i]]?.position || [0, 0, 0];
      const t = velocities.current[i];
      posArr[i * 3] = src[0] + (tgt[0] - src[0]) * t;
      posArr[i * 3 + 1] = src[1] + (tgt[1] - src[1]) * t;
      posArr[i * 3 + 2] = src[2] + (tgt[2] - src[2]) * t;
    }

    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={particleCount} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={particleCount} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.15} vertexColors transparent opacity={0.95} sizeAttenuation />
    </points>
  );
}

export function ConstellationScene({ agents, onNodeClick, isExecutiveMode, neutralizedCount = 0 }: ConstellationSceneProps) {
  const handleClick = useCallback((agent: AgentNode) => { onNodeClick?.(agent); }, [onNodeClick]);

  const visibleAgents = isExecutiveMode
    ? agents.filter((a) => a.tier === "primary" || a.tier === "secondary")
    : agents;

  return (
    <Canvas
      camera={{ position: [0, 2, 20], fov: 55 }}
      style={{ background: "#020408" }}
      gl={{ antialias: true, alpha: false }}
    >
      <ambientLight intensity={0.08} />
      <directionalLight position={[10, 10, 5]} intensity={0.15} color="#4488ff" />
      <directionalLight position={[-10, -5, -5]} intensity={0.08} color="#ff6600" />

      <DeepSpaceField neutralizedCount={neutralizedCount} />

      {/* Nebula clouds for atmosphere */}
      <NebulaCloud position={[-15, 8, -20]} color="#1e40af" scale={8} />
      <NebulaCloud position={[18, -5, -25]} color="#ea580c" scale={10} />
      <NebulaCloud position={[5, 12, -30]} color="#7c3aed" scale={6} />
      <NebulaCloud position={[-8, -10, -15]} color="#0ea5e9" scale={5} />

      <ConnectionLines agents={visibleAgents} />
      <SignalParticles agents={visibleAgents} />

      {visibleAgents.map((agent) => (
        <AgentSphere key={agent.id} agent={agent} onClick={() => handleClick(agent)} />
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom
        minDistance={8}
        maxDistance={40}
        autoRotate
        autoRotateSpeed={0.2}
        dampingFactor={0.05}
        enableDamping
      />
    </Canvas>
  );
}

export type { AgentNode };
