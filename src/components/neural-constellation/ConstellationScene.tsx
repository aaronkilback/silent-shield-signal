import { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame, extend } from "@react-three/fiber";
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
}

// Starfield background
function StarField() {
  const ref = useRef<THREE.Points>(null);
  const count = 2000;

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 100;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 100;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }
    return pos;
  }, []);

  const sizes = useMemo(() => {
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      s[i] = Math.random() * 0.5 + 0.1;
    }
    return s;
  }, []);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.005;
      ref.current.rotation.x += delta * 0.002;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          count={count}
          array={sizes}
          itemSize={1}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.15}
        color="#334155"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

// Individual agent node
function AgentSphere({
  agent,
  onClick,
}: {
  agent: AgentNode;
  onClick?: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(0);

  const color = new THREE.Color(agent.color);
  const size = agent.tier === "primary" ? 0.6 : agent.tier === "secondary" ? 0.4 : 0.3;

  useFrame((_, delta) => {
    pulseRef.current += delta * 2;
    if (meshRef.current) {
      const scale = 1 + Math.sin(pulseRef.current) * 0.08;
      meshRef.current.scale.setScalar(scale);
    }
    if (glowRef.current) {
      const glowScale = 1.8 + Math.sin(pulseRef.current * 0.7) * 0.3;
      glowRef.current.scale.setScalar(glowScale);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.12 + Math.sin(pulseRef.current) * 0.05;
    }
  });

  return (
    <group position={agent.position}>
      {/* Outer glow */}
      <mesh ref={glowRef} onClick={onClick}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} />
      </mesh>
      {/* Core sphere */}
      <mesh ref={meshRef} onClick={onClick}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>
      {/* Point light for local illumination */}
      <pointLight color={agent.color} intensity={0.5} distance={5} />
    </group>
  );
}

// Connection lines between agents
function ConnectionLines({ agents }: { agents: AgentNode[] }) {
  const linesRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);

  // Define connections - primary agents connect to related secondary agents
  const connections = useMemo(() => {
    const conns: [number, number][] = [];
    const primaryIndices = agents
      .map((a, i) => (a.tier === "primary" ? i : -1))
      .filter((i) => i >= 0);

    // Connect all primaries to each other
    for (let i = 0; i < primaryIndices.length; i++) {
      for (let j = i + 1; j < primaryIndices.length; j++) {
        conns.push([primaryIndices[i], primaryIndices[j]]);
      }
    }

    // Connect secondary/support to nearest primary
    agents.forEach((agent, idx) => {
      if (agent.tier !== "primary") {
        let nearest = primaryIndices[0];
        let minDist = Infinity;
        primaryIndices.forEach((pi) => {
          const dx = agent.position[0] - agents[pi].position[0];
          const dy = agent.position[1] - agents[pi].position[1];
          const dz = agent.position[2] - agents[pi].position[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < minDist) {
            minDist = dist;
            nearest = pi;
          }
        });
        conns.push([idx, nearest]);
      }
    });

    return conns;
  }, [agents]);

  useFrame((_, delta) => {
    timeRef.current += delta;
  });

  return (
    <group ref={linesRef}>
      {connections.map(([a, b], idx) => {
        const points = [
          new THREE.Vector3(...agents[a].position),
          new THREE.Vector3(...agents[b].position),
        ];
        const isPrimaryConnection =
          agents[a].tier === "primary" && agents[b].tier === "primary";
        return (
          <Line
            key={idx}
            points={points}
            color={isPrimaryConnection ? "#1e40af" : "#1e293b"}
            transparent
            opacity={isPrimaryConnection ? 0.35 : 0.15}
            lineWidth={1}
          />
        );
      })}
    </group>
  );
}

// Signal particles flowing along connections
function SignalParticles({ agents }: { agents: AgentNode[] }) {
  const particleCount = 30;
  const ref = useRef<THREE.Points>(null);
  const velocities = useRef<Float32Array>(new Float32Array(particleCount));
  const targets = useRef<number[]>([]);
  const sources = useRef<number[]>([]);

  const positions = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const primaryIndices = agents
      .map((a, i) => (a.tier === "primary" ? i : -1))
      .filter((i) => i >= 0);

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
    }
    return pos;
  }, [agents]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    const posArr = ref.current.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      velocities.current[i] += delta * (0.15 + Math.random() * 0.1);

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
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.12}
        color="#22d3ee"
        transparent
        opacity={0.9}
        sizeAttenuation
      />
    </points>
  );
}

export function ConstellationScene({
  agents,
  onNodeClick,
  isExecutiveMode,
}: ConstellationSceneProps) {
  const handleClick = useCallback(
    (agent: AgentNode) => {
      onNodeClick?.(agent);
    },
    [onNodeClick]
  );

  const visibleAgents = isExecutiveMode
    ? agents.filter((a) => a.tier === "primary" || a.tier === "secondary")
    : agents;

  return (
    <Canvas
      camera={{ position: [0, 0, 18], fov: 60 }}
      style={{ background: "transparent" }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.15} />
      <directionalLight position={[10, 10, 5]} intensity={0.3} />

      <StarField />
      <ConnectionLines agents={visibleAgents} />
      <SignalParticles agents={visibleAgents} />

      {visibleAgents.map((agent) => (
        <AgentSphere
          key={agent.id}
          agent={agent}
          onClick={() => handleClick(agent)}
        />
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={8}
        maxDistance={35}
        autoRotate
        autoRotateSpeed={0.3}
        dampingFactor={0.05}
        enableDamping
      />
    </Canvas>
  );
}

export type { AgentNode };
