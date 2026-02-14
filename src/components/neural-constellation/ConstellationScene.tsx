import { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import type { AgentCommLink, ActiveDebate, ScanPulse } from "@/hooks/useConstellationData";

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
  commLinks?: AgentCommLink[];
  activeDebates?: ActiveDebate[];
  scanPulses?: ScanPulse[];
}

// Deep space starfield
function DeepSpaceField({ neutralizedCount = 0 }: { neutralizedCount: number }) {
  const ref = useRef<THREE.Points>(null);
  const totalStars = 4000;

  const { positions, colors, sizes } = useMemo(() => {
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const dimmableCount = Math.min(neutralizedCount * 8, totalStars * 0.4);

    for (let i = 0; i < totalStars; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 30 + Math.random() * 70;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);

      const isDimmed = i < dimmableCount;
      const colorRoll = Math.random();

      if (isDimmed) {
        const fade = 0.05 + Math.random() * 0.08;
        col[i * 3] = fade; col[i * 3 + 1] = fade; col[i * 3 + 2] = fade;
        sz[i] = 0.02 + Math.random() * 0.05;
      } else if (colorRoll < 0.5) {
        col[i * 3] = 0.7 + Math.random() * 0.3; col[i * 3 + 1] = 0.8 + Math.random() * 0.2; col[i * 3 + 2] = 1.0;
        sz[i] = 0.08 + Math.random() * 0.25;
      } else if (colorRoll < 0.8) {
        const b = 0.85 + Math.random() * 0.15;
        col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b;
        sz[i] = 0.06 + Math.random() * 0.2;
      } else {
        col[i * 3] = 0.95 + Math.random() * 0.05; col[i * 3 + 1] = 0.5 + Math.random() * 0.3; col[i * 3 + 2] = 0.1 + Math.random() * 0.15;
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

// Nebula glow clouds
function NebulaCloud({ position, color, scale = 3 }: { position: [number, number, number]; color: string; scale?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => { if (ref.current) ref.current.rotation.z += delta * 0.01; });

  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[scale, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.04} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Agent node with cinematic glow — enhanced for debate participation
function AgentSphere({ agent, onClick, isInDebate }: { agent: AgentNode; onClick?: () => void; isInDebate?: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(Math.random() * Math.PI * 2);

  const color = new THREE.Color(agent.color);
  const size = agent.tier === "primary" ? 0.5 : agent.tier === "secondary" ? 0.35 : 0.22;

  useFrame((_, delta) => {
    pulseRef.current += delta * (isInDebate ? 3.5 : 1.8);
    const pulse = Math.sin(pulseRef.current);

    if (meshRef.current) {
      meshRef.current.scale.setScalar(1 + pulse * (isInDebate ? 0.15 : 0.06));
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar((isInDebate ? 3.0 : 2.2) + pulse * 0.4);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = (isInDebate ? 0.25 : 0.15) + pulse * 0.05;
    }
    if (outerRef.current) {
      outerRef.current.scale.setScalar((isInDebate ? 5.0 : 3.5) + pulse * 0.6);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = (isInDebate ? 0.08 : 0.04) + pulse * 0.02;
    }
  });

  return (
    <group position={agent.position}>
      <mesh ref={outerRef} onClick={onClick}>
        <sphereGeometry args={[size, 12, 12]} />
        <meshBasicMaterial color={isInDebate ? "#f59e0b" : color} transparent opacity={0.04} />
      </mesh>
      <mesh ref={glowRef} onClick={onClick}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshBasicMaterial color={isInDebate ? "#f59e0b" : color} transparent opacity={0.15} />
      </mesh>
      <mesh ref={meshRef} onClick={onClick}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={isInDebate ? new THREE.Color("#f59e0b") : color}
          emissiveIntensity={isInDebate ? 1.5 : 0.8}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
      <pointLight
        color={isInDebate ? "#f59e0b" : agent.color}
        intensity={isInDebate ? 2.0 : agent.tier === "primary" ? 1.2 : 0.5}
        distance={isInDebate ? 12 : agent.tier === "primary" ? 8 : 4}
      />
    </group>
  );
}

// Connection lines — real comm links shown brighter
function ConnectionLines({ agents, commLinks = [] }: { agents: AgentNode[]; commLinks?: AgentCommLink[] }) {
  const connections = useMemo(() => {
    const conns: { a: number; b: number; isReal: boolean; strength: number }[] = [];
    const callSignIndex = new Map(agents.map((a, i) => [a.callSign, i]));
    const primaryIndices = agents.map((a, i) => (a.tier === "primary" ? i : -1)).filter((i) => i >= 0);

    // Real communication links — bright and prominent
    const realPairs = new Set<string>();
    commLinks.forEach((link) => {
      const srcIdx = callSignIndex.get(link.sourceCallSign);
      const tgtIdx = callSignIndex.get(link.targetCallSign);
      if (srcIdx !== undefined && tgtIdx !== undefined) {
        const key = [Math.min(srcIdx, tgtIdx), Math.max(srcIdx, tgtIdx)].join("-");
        if (!realPairs.has(key)) {
          realPairs.add(key);
          conns.push({ a: srcIdx, b: tgtIdx, isReal: true, strength: Math.min(link.messageCount / 10, 1) });
        }
      }
    });

    // Fallback structural connections (dimmer)
    for (let i = 0; i < primaryIndices.length; i++) {
      for (let j = i + 1; j < primaryIndices.length; j++) {
        const key = [primaryIndices[i], primaryIndices[j]].join("-");
        if (!realPairs.has(key)) {
          conns.push({ a: primaryIndices[i], b: primaryIndices[j], isReal: false, strength: 0.3 });
        }
      }
    }

    agents.forEach((agent, idx) => {
      if (agent.tier !== "primary") {
        // Check if already has a real link
        const hasRealLink = commLinks.some(
          (l) => l.sourceCallSign === agent.callSign || l.targetCallSign === agent.callSign
        );
        if (!hasRealLink) {
          let nearest = primaryIndices[0];
          let minDist = Infinity;
          primaryIndices.forEach((pi) => {
            const dx = agent.position[0] - agents[pi].position[0];
            const dy = agent.position[1] - agents[pi].position[1];
            const dz = agent.position[2] - agents[pi].position[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < minDist) { minDist = dist; nearest = pi; }
          });
          conns.push({ a: idx, b: nearest, isReal: false, strength: 0.15 });
        }
      }
    });

    return conns;
  }, [agents, commLinks]);

  return (
    <group>
      {connections.map((conn, idx) => {
        const points = [new THREE.Vector3(...agents[conn.a].position), new THREE.Vector3(...agents[conn.b].position)];
        return (
          <Line
            key={idx}
            points={points}
            color={conn.isReal ? "#22d3ee" : "#3b82f6"}
            transparent
            opacity={conn.isReal ? 0.4 + conn.strength * 0.3 : conn.strength * 0.3}
            lineWidth={conn.isReal ? 1.5 + conn.strength : 0.8}
          />
        );
      })}
    </group>
  );
}

// Real signal particles — travel along actual comm links
function SignalParticles({ agents, commLinks = [] }: { agents: AgentNode[]; commLinks?: AgentCommLink[] }) {
  const particleCount = 50;
  const ref = useRef<THREE.Points>(null);
  const velocities = useRef(new Float32Array(particleCount));
  const targets = useRef<number[]>([]);
  const sources = useRef<number[]>([]);

  const callSignIndex = useMemo(() => new Map(agents.map((a, i) => [a.callSign, i])), [agents]);

  // Build route pairs from real comm links
  const routePairs = useMemo(() => {
    const pairs: [number, number][] = [];
    commLinks.forEach((link) => {
      const src = callSignIndex.get(link.sourceCallSign);
      const tgt = callSignIndex.get(link.targetCallSign);
      if (src !== undefined && tgt !== undefined) {
        // Weight by message count — more messages = more particles use this route
        const weight = Math.min(Math.ceil(link.messageCount / 5), 5);
        for (let w = 0; w < weight; w++) pairs.push([src, tgt]);
      }
    });
    // Fallback: if no real links, use primary-to-all
    if (pairs.length === 0) {
      const primaries = agents.map((a, i) => (a.tier === "primary" ? i : -1)).filter((i) => i >= 0);
      agents.forEach((_, idx) => {
        const pi = primaries[Math.floor(Math.random() * primaries.length)];
        if (pi !== undefined) pairs.push([idx, pi]);
      });
    }
    return pairs;
  }, [agents, commLinks, callSignIndex]);

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const pair = routePairs[i % routePairs.length] || [0, Math.min(1, agents.length - 1)];
      sources.current[i] = pair[0];
      targets.current[i] = pair[1];
      velocities.current[i] = Math.random();

      const src = agents[pair[0]]?.position || [0, 0, 0];
      const tgt = agents[pair[1]]?.position || [0, 0, 0];
      const t = velocities.current[i];
      pos[i * 3] = src[0] + (tgt[0] - src[0]) * t;
      pos[i * 3 + 1] = src[1] + (tgt[1] - src[1]) * t;
      pos[i * 3 + 2] = src[2] + (tgt[2] - src[2]) * t;

      // Real comms = cyan, structural = dimmer blue
      const isReal = commLinks.length > 0;
      if (isReal) {
        col[i * 3] = 0.13; col[i * 3 + 1] = 0.83; col[i * 3 + 2] = 0.93;
      } else {
        col[i * 3] = 0.3; col[i * 3 + 1] = 0.5; col[i * 3 + 2] = 0.9;
      }
    }
    return { positions: pos, colors: col };
  }, [agents, routePairs, commLinks.length]);

  useFrame((_, delta) => {
    if (!ref.current || agents.length === 0) return;
    const posArr = ref.current.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      velocities.current[i] += delta * (0.12 + Math.random() * 0.08);

      if (velocities.current[i] >= 1) {
        velocities.current[i] = 0;
        // Pick a new real route
        const pair = routePairs[Math.floor(Math.random() * routePairs.length)] || [0, 0];
        sources.current[i] = pair[0];
        targets.current[i] = pair[1];
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

// Debate cluster ring — visual indicator of agents reconfiguring around a problem
function DebateClusterRing({ agents, debate }: { agents: AgentNode[]; debate: ActiveDebate }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const participants = debate.participatingAgents;

  // Calculate centroid of participating agents
  const centroid = useMemo(() => {
    const matched = agents.filter((a) => participants.includes(a.callSign));
    if (matched.length === 0) return [0, 0, 0] as [number, number, number];
    const cx = matched.reduce((s, a) => s + a.position[0], 0) / matched.length;
    const cy = matched.reduce((s, a) => s + a.position[1], 0) / matched.length;
    const cz = matched.reduce((s, a) => s + a.position[2], 0) / matched.length;
    return [cx, cy, cz] as [number, number, number];
  }, [agents, participants]);

  const radius = useMemo(() => {
    const matched = agents.filter((a) => participants.includes(a.callSign));
    if (matched.length < 2) return 2;
    let maxDist = 0;
    matched.forEach((a) => {
      const dx = a.position[0] - centroid[0];
      const dy = a.position[1] - centroid[1];
      const dz = a.position[2] - centroid[2];
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
    });
    return maxDist + 1.5;
  }, [agents, participants, centroid]);

  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.5;
      ringRef.current.rotation.x += delta * 0.15;
    }
  });

  const hasParticipants = agents.some((a) => participants.includes(a.callSign));
  if (!hasParticipants) return null;

  return (
    <group position={centroid}>
      <mesh ref={ringRef}>
        <torusGeometry args={[radius, 0.03, 8, 64]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.4} />
      </mesh>
      {/* Outer pulse ring */}
      <mesh rotation={[Math.PI / 4, 0, 0]}>
        <torusGeometry args={[radius * 1.2, 0.02, 8, 64]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export function ConstellationScene({
  agents,
  onNodeClick,
  isExecutiveMode,
  neutralizedCount = 0,
  commLinks = [],
  activeDebates = [],
  scanPulses = [],
}: ConstellationSceneProps) {
  const handleClick = useCallback((agent: AgentNode) => { onNodeClick?.(agent); }, [onNodeClick]);

  const visibleAgents = isExecutiveMode
    ? agents.filter((a) => a.tier === "primary" || a.tier === "secondary")
    : agents;

  // Set of agents currently in debates
  const debatingAgents = useMemo(() => {
    const set = new Set<string>();
    activeDebates.forEach((d) => d.participatingAgents.forEach((a) => set.add(a)));
    return set;
  }, [activeDebates]);

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

      <NebulaCloud position={[-15, 8, -20]} color="#1e40af" scale={8} />
      <NebulaCloud position={[18, -5, -25]} color="#ea580c" scale={10} />
      <NebulaCloud position={[5, 12, -30]} color="#7c3aed" scale={6} />
      <NebulaCloud position={[-8, -10, -15]} color="#0ea5e9" scale={5} />

      <ConnectionLines agents={visibleAgents} commLinks={commLinks} />
      <SignalParticles agents={visibleAgents} commLinks={commLinks} />

      {/* Debate cluster rings */}
      {activeDebates.map((debate) => (
        <DebateClusterRing key={debate.id} agents={visibleAgents} debate={debate} />
      ))}

      {visibleAgents.map((agent) => (
        <AgentSphere
          key={agent.id}
          agent={agent}
          onClick={() => handleClick(agent)}
          isInDebate={debatingAgents.has(agent.callSign)}
        />
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
