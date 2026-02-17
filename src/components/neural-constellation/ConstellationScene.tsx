import { useRef, useMemo, useCallback, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Html, useTexture } from "@react-three/drei";
// Post-processing removed due to R3F v8 compatibility issues
import * as THREE from "three";
import { MilkyWayBand, PlanetParade, AsteroidBelt, Comets } from "./SolarSystemElements";
import { EndorBattle } from "./EndorBattle";
import type { AgentCommLink, ActiveDebate, ScanPulse, AgentActivityMetrics, KnowledgeGraphEdge, OperatorDevice, OperatorMessageActivity, KnowledgeGrowthData } from "@/hooks/useConstellationData";
import type { FortressHealth } from "@/hooks/useFortressHealth";

interface AgentNode {
  id: string;
  callSign: string;
  codename: string;
  specialty: string;
  color: string;
  position: [number, number, number];
  tier: "primary" | "secondary" | "support";
}

type CameraView = "constellation" | "earth" | "cinematic";

interface ConstellationSceneProps {
  agents: AgentNode[];
  onNodeClick?: (agent: AgentNode) => void;
  isExecutiveMode: boolean;
  neutralizedCount?: number;
  commLinks?: AgentCommLink[];
  activeDebates?: ActiveDebate[];
  scanPulses?: ScanPulse[];
  activityMetrics?: AgentActivityMetrics[];
  knowledgeGraphEdges?: KnowledgeGraphEdge[];
  operatorDevices?: OperatorDevice[];
  operatorMessageActivity?: OperatorMessageActivity;
  signalLocations?: string[];
  knowledgeGrowth?: KnowledgeGrowthData;
  fortressHealth?: FortressHealth;
  showBattle?: boolean;
}

// Camera presets
const CAMERA_PRESETS: Record<CameraView, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  constellation: { position: new THREE.Vector3(0, 2, 20), target: new THREE.Vector3(0, 0, 0) },
  earth: { position: new THREE.Vector3(-27, -10, -32), target: new THREE.Vector3(-35, -15, -40) },
  cinematic: { position: new THREE.Vector3(-15, 8, 10), target: new THREE.Vector3(-10, -5, -15) },
};

// Smooth cinematic camera controller — only animates during transitions and cinematic mode
function CameraController({ view, controlsRef }: { view: CameraView; controlsRef: React.RefObject<any> }) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 2, 20));
  const targetLook = useRef(new THREE.Vector3(0, 0, 0));
  const cinematicPhase = useRef(0);
  const isTransitioning = useRef(false);
  const transitionProgress = useRef(0);
  const prevView = useRef<CameraView>(view);

  useEffect(() => {
    const preset = CAMERA_PRESETS[view];
    targetPos.current.copy(preset.position);
    targetLook.current.copy(preset.target);
    if (view !== prevView.current) {
      isTransitioning.current = true;
      transitionProgress.current = 0;
      prevView.current = view;
    }
  }, [view]);

  useFrame((_, delta) => {
    if (view === "cinematic") {
      cinematicPhase.current += delta * 0.06;
      const t = cinematicPhase.current;
      const px = Math.sin(t) * 25;
      const py = Math.cos(t * 0.7) * 8 + 2;
      const pz = Math.cos(t) * 20 + 5;
      targetPos.current.set(px, py, pz);
      const lx = Math.sin(t + 1) * -15;
      const ly = Math.cos(t * 0.5) * -5;
      const lz = Math.sin(t * 0.8) * -15;
      targetLook.current.set(lx, ly, lz);

      camera.position.lerp(targetPos.current, delta * 1.2);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetLook.current, delta * 1.2);
        controlsRef.current.update();
      }
    } else if (isTransitioning.current) {
      transitionProgress.current += delta * 1.8;
      const progress = Math.min(transitionProgress.current, 1);
      // Use a smooth ease-out curve for snappy transitions
      const ease = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(camera.position, targetPos.current, Math.min(ease * 0.15 + 0.02, 1));
      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetLook.current, Math.min(ease * 0.15 + 0.02, 1));
        controlsRef.current.update();
      }
      // End transition when close enough
      if (camera.position.distanceTo(targetPos.current) < 0.5) {
        camera.position.copy(targetPos.current);
        if (controlsRef.current) {
          controlsRef.current.target.copy(targetLook.current);
          controlsRef.current.update();
        }
        isTransitioning.current = false;
      }
    }
    // When not transitioning and not cinematic, user has full manual control
  });

  return null;
}

// Shooting stars — streaks across the scene
function ShootingStars() {
  const count = 8;
  const ref = useRef<THREE.Group>(null);
  const stars = useRef<{ pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number; active: boolean }[]>([]);

  useMemo(() => {
    stars.current = Array.from({ length: count }, () => ({
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(0, 0, 0),
      life: 0,
      maxLife: 0,
      active: false,
    }));
  }, []);

  useFrame((_, delta) => {
    stars.current.forEach((star) => {
      if (!star.active) {
        if (Math.random() < 0.003) {
          // Spawn
          star.active = true;
          star.life = 0;
          star.maxLife = 0.8 + Math.random() * 1.2;
          star.pos.set(
            (Math.random() - 0.5) * 80,
            20 + Math.random() * 30,
            (Math.random() - 0.5) * 80
          );
          star.vel.set(
            (Math.random() - 0.5) * 30,
            -15 - Math.random() * 20,
            (Math.random() - 0.5) * 30
          );
        }
        return;
      }
      star.life += delta;
      star.pos.addScaledVector(star.vel, delta);
      if (star.life > star.maxLife) star.active = false;
    });
  });

  return (
    <group ref={ref}>
      {stars.current.map((star, i) => (
        <ShootingStarTrail key={i} star={star} />
      ))}
    </group>
  );
}

function ShootingStarTrail({ star }: { star: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; maxLife: number; active: boolean } }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const trailRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!star.active) {
      if (meshRef.current) (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      if (trailRef.current) (trailRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      return;
    }
    const fade = 1 - star.life / star.maxLife;
    if (meshRef.current) {
      meshRef.current.position.copy(star.pos);
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.9;
    }
    if (trailRef.current) {
      const trailDir = star.vel.clone().normalize();
      trailRef.current.position.copy(star.pos).addScaledVector(trailDir, -1.5);
      trailRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), trailDir.negate());
      (trailRef.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.4;
    }
  });

  return (
    <>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.08, 6, 6]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} />
      </mesh>
      <mesh ref={trailRef}>
        <cylinderGeometry args={[0.04, 0.0, 3, 4]} />
        <meshBasicMaterial color="#aaddff" transparent opacity={0} />
      </mesh>
    </>
  );
}


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

// Performance halo ring around agent nodes
function PerformanceHalo({ position, activityScore, color, size }: {
  position: [number, number, number];
  activityScore: number;
  color: string;
  size: number;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(Math.random() * Math.PI * 2);

  // Halo color based on activity: green=high, cyan=medium, dim=low
  const haloColor = activityScore > 0.7 ? "#10b981" : activityScore > 0.3 ? "#22d3ee" : "#475569";
  const haloOpacity = 0.15 + activityScore * 0.35;

  useFrame((_, delta) => {
    pulseRef.current += delta * (1 + activityScore * 2);
    if (ringRef.current) {
      const pulse = Math.sin(pulseRef.current);
      ringRef.current.rotation.x += delta * 0.3;
      ringRef.current.rotation.y += delta * 0.2;
      const scale = 1 + pulse * 0.08 * activityScore;
      ringRef.current.scale.setScalar(scale);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = haloOpacity + pulse * 0.05;
    }
  });

  if (activityScore < 0.05) return null;

  return null;
}

// AEGIS Command Hub — unique central node with orbital rings
function AegisCommandHub({ agent, onClick, activityScore = 0, onHover, onUnhover }: {
  agent: AgentNode;
  onClick?: () => void;
  activityScore?: number;
  onHover?: (agent: AgentNode) => void;
  onUnhover?: () => void;
}) {
  const coreRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const ring3Ref = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(0);
  const [hovered, setHovered] = useState(false);

  const color = new THREE.Color("#f59e0b");
  const size = 0.7;

  useFrame((_, delta) => {
    pulseRef.current += delta * 2.0;
    const pulse = Math.sin(pulseRef.current);

    if (coreRef.current) {
      coreRef.current.scale.setScalar(1 + pulse * 0.06);
    }
    if (ring1Ref.current) {
      ring1Ref.current.rotation.x += delta * 0.4;
      ring1Ref.current.rotation.z += delta * 0.15;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.y += delta * 0.3;
      ring2Ref.current.rotation.x += delta * 0.1;
    }
    if (ring3Ref.current) {
      ring3Ref.current.rotation.z += delta * 0.5;
      ring3Ref.current.rotation.y += delta * 0.2;
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(4.0 + pulse * 0.6);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.04;
    }
  });

  const handlePointerOver = useCallback(() => {
    setHovered(true);
    onHover?.(agent);
    document.body.style.cursor = "pointer";
  }, [agent, onHover]);

  const handlePointerOut = useCallback(() => {
    setHovered(false);
    onUnhover?.();
    document.body.style.cursor = "auto";
  }, [onUnhover]);

  return (
    <group position={agent.position}>
      {/* Outer detection sphere for interaction */}
      <mesh onClick={onClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        <sphereGeometry args={[2.5, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {/* Ambient glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.12} />
      </mesh>
      {/* Core sphere */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.8}
          roughness={0.1}
          metalness={0.9}
        />
      </mesh>
      {/* Strong point light — AEGIS illuminates the constellation */}
      <pointLight color="#f59e0b" intensity={3.0} distance={25} />
      <pointLight color="#fbbf24" intensity={1.0} distance={15} />
      {/* Hover tooltip */}
      {hovered && (
        <Html center distanceFactor={18} style={{ pointerEvents: "none" }}>
          <div className="bg-card/95 backdrop-blur-xl border border-amber-500/40 rounded-lg px-4 py-3 min-w-[200px] shadow-2xl" style={{ transform: "translateY(-50px)" }}>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <div className="text-sm font-bold text-amber-400 tracking-widest">AEGIS-CMD</div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Primary Command AI • Orchestrator</div>
            <div className="text-[10px] text-amber-400/70 mt-1.5 border-t border-amber-500/20 pt-1.5">
              All agent communications route through AEGIS
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// Operator device node — represents a connected mobile/desktop client
function OperatorDeviceNode({ position, isOnline = false, deviceCount = 0, hasMessageActivity = false, onHover, onUnhover }: {
  position: [number, number, number];
  isOnline?: boolean;
  deviceCount?: number;
  hasMessageActivity?: boolean;
  onHover?: () => void;
  onUnhover?: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(0);
  const [hovered, setHovered] = useState(false);

  // Online if heartbeat OR recent message activity
  const isActive = isOnline || hasMessageActivity;

  const activeColor = new THREE.Color("#10b981");
  const messagingColor = new THREE.Color("#22d3ee");
  const offlineColor = new THREE.Color("#475569");
  const color = isActive ? (hasMessageActivity && !isOnline ? messagingColor : activeColor) : offlineColor;

  useFrame((_, delta) => {
    pulseRef.current += delta * (isActive ? 1.5 : 0.3);
    const pulse = Math.sin(pulseRef.current);
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * (isActive ? 0.4 : 0.1);
    }
    if (coreRef.current) {
      coreRef.current.scale.setScalar(1 + pulse * (isActive ? 0.05 : 0.02));
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (isActive ? 0.8 : 0.2);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = isActive ? 0.3 + pulse * 0.1 : 0.1;
    }
  });

  const handleOver = useCallback(() => { setHovered(true); onHover?.(); document.body.style.cursor = "pointer"; }, [onHover]);
  const handleOut = useCallback(() => { setHovered(false); onUnhover?.(); document.body.style.cursor = "auto"; }, [onUnhover]);

  return (
    <group position={position}>
      <mesh onPointerOver={handleOver} onPointerOut={handleOut}>
        <sphereGeometry args={[1.2, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <group ref={groupRef} rotation={[Math.PI / 4, 0, Math.PI / 4]}>
        <mesh ref={coreRef}>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isActive ? 1.2 : 0.3} roughness={0.15} metalness={0.9} />
        </mesh>
      </group>
      {/* ring removed */}
      <mesh>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial color={isActive ? "#10b981" : "#475569"} transparent opacity={isActive ? 0.06 : 0.02} />
      </mesh>
      <pointLight color={isActive ? "#10b981" : "#334155"} intensity={isActive ? 1.0 : 0.15} distance={isActive ? 8 : 3} />
      {hovered && (
        <Html center distanceFactor={18} style={{ pointerEvents: "none" }}>
          <div className="bg-card/95 backdrop-blur-xl border rounded-lg px-4 py-3 min-w-[180px] shadow-2xl" style={{ transform: "translateY(-45px)", borderColor: isActive ? "rgba(16,185,129,0.4)" : "rgba(71,85,105,0.4)" }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: isActive ? "#10b981" : "#64748b", animation: isActive ? "pulse 2s infinite" : "none" }} />
              <div className="text-xs font-bold tracking-widest" style={{ color: isActive ? "#10b981" : "#64748b" }}>OPERATOR</div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {isOnline ? `${deviceCount} Device${deviceCount !== 1 ? "s" : ""} · Connected` : hasMessageActivity ? "Active via AEGIS Chat" : "No Active Devices"}
            </div>
            <div className="text-[9px] mt-1.5 border-t pt-1.5" style={{ color: isActive ? "rgba(16,185,129,0.7)" : "rgba(100,116,139,0.7)", borderColor: isActive ? "rgba(16,185,129,0.2)" : "rgba(71,85,105,0.2)" }}>
              {isOnline ? "Live operator link via Fortress Mobile" : hasMessageActivity ? "Recent AEGIS messages detected" : "No mobile sessions in last 5 min"}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// Agent node with activity-driven pulse speed + hover tooltip
function AgentSphere({ agent, onClick, isInDebate, activityScore = 0, onHover, onUnhover }: {
  agent: AgentNode;
  onClick?: () => void;
  isInDebate?: boolean;
  activityScore?: number;
  onHover?: (agent: AgentNode) => void;
  onUnhover?: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef(Math.random() * Math.PI * 2);
  const [hovered, setHovered] = useState(false);

  const color = new THREE.Color(agent.color);
  const size = agent.tier === "primary" ? 0.6 : agent.tier === "secondary" ? 0.38 : 0.22;

  // Activity drives pulse speed: more active = faster pulse
  const basePulseSpeed = 1.2 + activityScore * 3.5;
  const pulseSpeed = isInDebate ? 4.0 : basePulseSpeed;
  const pulseAmplitude = isInDebate ? 0.15 : 0.04 + activityScore * 0.12;

  useFrame((_, delta) => {
    pulseRef.current += delta * pulseSpeed;
    const pulse = Math.sin(pulseRef.current);

    if (meshRef.current) {
      meshRef.current.scale.setScalar(1 + pulse * pulseAmplitude);
    }
    if (glowRef.current) {
      const glowScale = (isInDebate ? 3.0 : 2.0 + activityScore * 1.0) + pulse * 0.4;
      glowRef.current.scale.setScalar(glowScale);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 
        (isInDebate ? 0.25 : 0.1 + activityScore * 0.15) + pulse * 0.05;
    }
    if (outerRef.current) {
      outerRef.current.scale.setScalar((isInDebate ? 5.0 : 3.0 + activityScore * 1.5) + pulse * 0.6);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = 
        (isInDebate ? 0.08 : 0.02 + activityScore * 0.04) + pulse * 0.02;
    }
  });

  const handlePointerOver = useCallback(() => {
    setHovered(true);
    onHover?.(agent);
    document.body.style.cursor = "pointer";
  }, [agent, onHover]);

  const handlePointerOut = useCallback(() => {
    setHovered(false);
    onUnhover?.();
    document.body.style.cursor = "auto";
  }, [onUnhover]);

  const emissiveColor = isInDebate ? new THREE.Color("#f59e0b") : color;
  const emissiveIntensity = isInDebate ? 1.5 : 0.5 + activityScore * 1.0;

  return (
    <group position={agent.position}>
      <mesh ref={outerRef} onClick={onClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        <sphereGeometry args={[size, 12, 12]} />
        <meshBasicMaterial color={isInDebate ? "#f59e0b" : color} transparent opacity={0.04} />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshBasicMaterial color={isInDebate ? "#f59e0b" : color} transparent opacity={0.15} />
      </mesh>
      <mesh ref={meshRef}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={emissiveIntensity}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
      <pointLight
        color={isInDebate ? "#f59e0b" : agent.color}
        intensity={isInDebate ? 2.0 : (agent.tier === "primary" ? 1.2 : agent.tier === "secondary" ? 0.5 : 0.2) + activityScore * 1.0}
        distance={isInDebate ? 12 : (agent.tier === "primary" ? 10 : agent.tier === "secondary" ? 6 : 3) + activityScore * 4}
      />
      {/* Tier label */}
      <Html center distanceFactor={22} style={{ pointerEvents: "none" }}>
        <div className="text-center" style={{ transform: "translateY(22px)" }}>
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{
            color: agent.color,
            textShadow: `0 0 8px ${agent.color}`,
            opacity: 0.85,
          }}>
            {agent.callSign}
          </div>
        </div>
      </Html>
      {/* Hover tooltip */}
      {hovered && (
        <Html center distanceFactor={18} style={{ pointerEvents: "none" }}>
          <div className="bg-card/95 backdrop-blur-xl border border-border rounded-lg px-3 py-2 min-w-[160px] shadow-2xl" style={{ transform: "translateY(-40px)" }}>
            <div className="text-xs font-bold text-foreground tracking-wider">{agent.callSign}</div>
            <div className="text-[10px] text-muted-foreground">{agent.codename}</div>
            <div className="text-[9px] mt-1 px-1.5 py-0.5 rounded-full inline-block" style={{
              backgroundColor: agent.tier === "primary" ? "rgba(59,130,246,0.2)" : agent.tier === "secondary" ? "rgba(139,92,246,0.2)" : "rgba(100,116,139,0.2)",
              color: agent.tier === "primary" ? "#60a5fa" : agent.tier === "secondary" ? "#a78bfa" : "#94a3b8",
              border: `1px solid ${agent.tier === "primary" ? "rgba(59,130,246,0.3)" : agent.tier === "secondary" ? "rgba(139,92,246,0.3)" : "rgba(100,116,139,0.3)"}`,
            }}>
              {agent.tier === "primary" ? "CORE" : agent.tier === "secondary" ? "SPECIALIST" : "SUPPORT"}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Activity</div>
                <div className="h-1 bg-secondary rounded-full mt-0.5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(5, activityScore * 100)}%`,
                      backgroundColor: activityScore > 0.7 ? "#10b981" : activityScore > 0.3 ? "#22d3ee" : "#64748b",
                    }}
                  />
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold" style={{ color: activityScore > 0.7 ? "#10b981" : activityScore > 0.3 ? "#22d3ee" : "#64748b" }}>
                {Math.round(activityScore * 100)}%
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground mt-1">{agent.specialty}</div>
            {isInDebate && (
              <div className="flex items-center gap-1 mt-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[9px] text-amber-400 font-medium">IN DEBATE</span>
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

// Connection lines — colored by edge state taxonomy (Inactive/Active/Battle-Tested/Redundant)
function ConnectionLines({ agents, commLinks = [], activityMetrics = [] }: { 
  agents: AgentNode[]; commLinks?: AgentCommLink[]; activityMetrics?: AgentActivityMetrics[];
}) {
  const activityMap = useMemo(() => {
    const map = new Map<string, number>();
    activityMetrics.forEach((m) => map.set(m.callSign, m.activityScore));
    return map;
  }, [activityMetrics]);

  const connections = useMemo(() => {
    const conns: { a: number; b: number; isReal: boolean; strength: number; edgeState: 'inactive' | 'active' | 'battle-tested' | 'redundant' }[] = [];
    const callSignIndex = new Map(agents.map((a, i) => [a.callSign, i]));
    const primaryIndices = agents.map((a, i) => (a.tier === "primary" ? i : -1)).filter((i) => i >= 0);

    const realPairs = new Set<string>();
    commLinks.forEach((link) => {
      const srcIdx = callSignIndex.get(link.sourceCallSign);
      const tgtIdx = callSignIndex.get(link.targetCallSign);
      if (srcIdx !== undefined && tgtIdx !== undefined) {
        const key = [Math.min(srcIdx, tgtIdx), Math.max(srcIdx, tgtIdx)].join("-");
        if (!realPairs.has(key)) {
          realPairs.add(key);
          const strength = Math.min(link.messageCount / 10, 1);
          const scoreA = activityMap.get(agents[srcIdx].callSign) || 0;
          const scoreB = activityMap.get(agents[tgtIdx].callSign) || 0;
          const combined = (scoreA + scoreB) / 2;
          
          let edgeState: 'inactive' | 'active' | 'battle-tested' | 'redundant';
          if (scoreA > 0.5 && scoreB > 0.5 && strength > 0.3) {
            edgeState = 'redundant';
          } else if (combined >= 0.35 || strength > 0.5) {
            edgeState = 'battle-tested';
          } else if (scoreA > 0 || scoreB > 0) {
            edgeState = 'active';
          } else {
            edgeState = 'inactive';
          }
          conns.push({ a: srcIdx, b: tgtIdx, isReal: true, strength, edgeState });
        }
      }
    });

    for (let i = 0; i < primaryIndices.length; i++) {
      for (let j = i + 1; j < primaryIndices.length; j++) {
        const key = [primaryIndices[i], primaryIndices[j]].join("-");
        if (!realPairs.has(key)) {
          const scoreA = activityMap.get(agents[primaryIndices[i]].callSign) || 0;
          const scoreB = activityMap.get(agents[primaryIndices[j]].callSign) || 0;
          const edgeState = (scoreA > 0 || scoreB > 0) ? 'active' as const : 'inactive' as const;
          conns.push({ a: primaryIndices[i], b: primaryIndices[j], isReal: false, strength: 0.3, edgeState });
        }
      }
    }

    // Ensure every agent connects to AEGIS-CMD
    const aegisIdx = callSignIndex.get("AEGIS-CMD");
    agents.forEach((agent, idx) => {
      if (idx === aegisIdx) return;
      const key = [Math.min(idx, aegisIdx ?? 0), Math.max(idx, aegisIdx ?? 0)].join("-");
      if (!realPairs.has(key) && aegisIdx !== undefined) {
        const score = activityMap.get(agent.callSign) || 0;
        const edgeState = score > 0.5 ? 'battle-tested' as const : score > 0 ? 'active' as const : 'inactive' as const;
        conns.push({ a: idx, b: aegisIdx, isReal: true, strength: 0.6, edgeState });
        realPairs.add(key);
      }
    });

    return conns;
  }, [agents, commLinks, activityMap]);

  const edgeVisuals: Record<string, { color: string; opacity: number; lineWidth: number; dashed: boolean; dashScale: number; dashSize: number; gapSize: number }> = {
    inactive:       { color: "#ef4444", opacity: 0.25, lineWidth: 0.8, dashed: true,  dashScale: 1, dashSize: 0.3, gapSize: 0.3 },
    active:         { color: "#f59e0b", opacity: 0.4,  lineWidth: 1.2, dashed: true,  dashScale: 1, dashSize: 0.6, gapSize: 0.2 },
    'battle-tested': { color: "#10b981", opacity: 0.55, lineWidth: 1.8, dashed: false, dashScale: 1, dashSize: 1,   gapSize: 0 },
    redundant:      { color: "#22d3ee", opacity: 0.65, lineWidth: 2.5, dashed: false, dashScale: 1, dashSize: 1,   gapSize: 0 },
  };

  return (
    <group>
      {connections.map((conn, idx) => {
        const points = [new THREE.Vector3(...agents[conn.a].position), new THREE.Vector3(...agents[conn.b].position)];
        const vis = edgeVisuals[conn.edgeState];
        return (
          <Line
            key={idx}
            points={points}
            color={vis.color}
            transparent
            opacity={vis.opacity}
            lineWidth={vis.lineWidth}
            dashed={vis.dashed}
            dashScale={vis.dashScale}
            dashSize={vis.dashSize}
            gapSize={vis.gapSize}
          />
        );
      })}
    </group>
  );
}

// Knowledge graph overlay — shows incident relationships as a separate visual layer
function KnowledgeGraphOverlay({ agents, edges }: { agents: AgentNode[]; edges: KnowledgeGraphEdge[] }) {
  const groupRef = useRef<THREE.Group>(null);

  // Map edges to visual connections between random agent pairs (since incidents aren't directly agent-mapped,
  // we distribute edges across the agent network to show the knowledge density)
  const graphConns = useMemo(() => {
    if (edges.length === 0) return [];

    const relationColors: Record<string, string> = {
      entity_overlap: "#a855f7",    // purple
      same_location: "#f59e0b",     // amber
      same_tactic: "#ef4444",       // red
      temporal_cluster: "#06b6d4",  // cyan
    };

    return edges.slice(0, 20).map((edge, i) => {
      // Distribute edges across agent network proportionally
      const srcIdx = i % agents.length;
      const tgtIdx = (i + Math.floor(agents.length / 3) + 1) % agents.length;
      return {
        from: agents[srcIdx].position,
        to: agents[tgtIdx].position,
        color: relationColors[edge.relationshipType] || "#6366f1",
        strength: edge.strength,
        type: edge.relationshipType,
      };
    });
  }, [agents, edges]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      // Subtle rotation to differentiate from comm lines
      groupRef.current.rotation.y += delta * 0.005;
    }
  });

  if (graphConns.length === 0) return null;

  return (
    <group ref={groupRef}>
      {graphConns.map((conn, idx) => {
        // Create a slight arc for knowledge graph lines to visually separate from comm lines
        const mid: [number, number, number] = [
          (conn.from[0] + conn.to[0]) / 2 + (Math.sin(idx) * 1.5),
          (conn.from[1] + conn.to[1]) / 2 + 1.5 + Math.cos(idx) * 0.5,
          (conn.from[2] + conn.to[2]) / 2 + (Math.cos(idx) * 1),
        ];
        const points = [
          new THREE.Vector3(...conn.from),
          new THREE.Vector3(...mid),
          new THREE.Vector3(...conn.to),
        ];
        return (
          <Line
            key={`kg-${idx}`}
            points={points}
            color={conn.color}
            transparent
            opacity={0.15 + conn.strength * 0.25}
            lineWidth={0.5 + conn.strength * 1.5}
            dashed
            dashSize={0.3}
            gapSize={0.2}
          />
        );
      })}
    </group>
  );
}

// Incident heat trail particles — flow between agents on shared incidents with severity coloring
function IncidentHeatTrails({ agents, activeDebates = [], scanPulses = [] }: {
  agents: AgentNode[];
  activeDebates?: ActiveDebate[];
  scanPulses?: ScanPulse[];
}) {
  const particleCount = 30;
  const ref = useRef<THREE.Points>(null);
  const velocities = useRef(new Float32Array(particleCount));
  const targets = useRef<number[]>([]);
  const sources = useRef<number[]>([]);

  const callSignIndex = useMemo(() => new Map(agents.map((a, i) => [a.callSign, i])), [agents]);

  // Build hot routes from debates and scans
  const hotRoutes = useMemo(() => {
    const routes: { from: number; to: number; severity: "critical" | "high" | "medium" }[] = [];

    // Debate participants form hot routes
    activeDebates.forEach((d) => {
      const participants = d.participatingAgents
        .map((cs) => callSignIndex.get(cs))
        .filter((idx): idx is number => idx !== undefined);
      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          const severity = (d.consensusScore ?? 0) < 0.5 ? "critical" : "high";
          routes.push({ from: participants[i], to: participants[j], severity });
        }
      }
    });

    // High-risk scans create trails to core nodes
    scanPulses.forEach((s) => {
      if ((s.riskScore ?? 0) > 50) {
        const srcIdx = callSignIndex.get(s.agentCallSign);
        if (srcIdx !== undefined) {
          // Connect to nearest primary
          const primaries = agents.map((a, i) => a.tier === "primary" ? i : -1).filter(i => i >= 0);
          if (primaries.length > 0) {
            routes.push({ from: srcIdx, to: primaries[0], severity: (s.riskScore ?? 0) > 75 ? "critical" : "medium" });
          }
        }
      }
    });

    // No ambient fallback — only show heat trails when real incidents/debates exist

    return routes;
  }, [agents, activeDebates, scanPulses, callSignIndex]);

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    if (hotRoutes.length === 0) return { positions: pos, colors: col };

    const severityColors = {
      critical: [1.0, 0.2, 0.15],
      high: [0.96, 0.62, 0.04],
      medium: [0.13, 0.83, 0.93],
    };

    for (let i = 0; i < particleCount; i++) {
      const route = hotRoutes[i % hotRoutes.length];
      sources.current[i] = route.from;
      targets.current[i] = route.to;
      velocities.current[i] = Math.random();

      const src = agents[route.from]?.position || [0, 0, 0];
      const tgt = agents[route.to]?.position || [0, 0, 0];
      const t = velocities.current[i];
      pos[i * 3] = src[0] + (tgt[0] - src[0]) * t;
      pos[i * 3 + 1] = src[1] + (tgt[1] - src[1]) * t;
      pos[i * 3 + 2] = src[2] + (tgt[2] - src[2]) * t;

      const c = severityColors[route.severity];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    return { positions: pos, colors: col };
  }, [agents, hotRoutes]);

  useFrame((_, delta) => {
    if (!ref.current || agents.length === 0 || hotRoutes.length === 0) return;
    const posArr = ref.current.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      velocities.current[i] += delta * (0.08 + Math.random() * 0.06);

      if (velocities.current[i] >= 1) {
        velocities.current[i] = 0;
        const route = hotRoutes[Math.floor(Math.random() * hotRoutes.length)];
        sources.current[i] = route.from;
        targets.current[i] = route.to;
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

  if (hotRoutes.length === 0) return null;

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={particleCount} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={particleCount} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.2} vertexColors transparent opacity={0.85} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// Activity-typed particles — visually represent what's actually happening across the network
// Each particle type has distinct color, size, and speed signatures
type ActivityType = "signal_ingest" | "scan_sweep" | "learning" | "message" | "alert" | "idle";

const ACTIVITY_VISUALS: Record<ActivityType, { color: [number, number, number]; size: number; speed: number; label: string }> = {
  signal_ingest: { color: [0.0, 1.0, 1.0],   size: 0.6, speed: 0.12, label: "Signal Ingestion" },    // Bright Cyan
  scan_sweep:    { color: [0.3, 0.5, 1.0],    size: 0.7, speed: 0.07, label: "OSINT Scan" },           // Blue
  learning:      { color: [0.6, 0.2, 1.0],    size: 0.5, speed: 0.05, label: "Knowledge Acquisition" },// Violet
  message:       { color: [0.0, 1.0, 0.5],    size: 0.6, speed: 0.15, label: "Agent Comms" },          // Green
  alert:         { color: [1.0, 0.2, 0.1],    size: 0.9, speed: 0.20, label: "Alert Escalation" },     // Red — large + fast
  idle:          { color: [0.4, 0.5, 0.65],    size: 0.25, speed: 0.03, label: "Standby" },              // Slate
};

// Programmatic circular glow texture for particles — created lazily
let _glowTexture: THREE.Texture | null = null;
function getGlowTexture(): THREE.Texture {
  if (_glowTexture) return _glowTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.8)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.15)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  _glowTexture = new THREE.CanvasTexture(canvas);
  _glowTexture.needsUpdate = true;
  return _glowTexture;
}

function SignalParticles({ agents, commLinks = [], activityMetrics = [], scanPulses = [] }: {
  agents: AgentNode[];
  commLinks?: AgentCommLink[];
  activityMetrics?: AgentActivityMetrics[];
  scanPulses?: ScanPulse[];
}) {
  const particleCount = 120;
  const ref = useRef<THREE.Points>(null);
  const sizeRef = useRef<THREE.BufferAttribute | null>(null);
  const velocities = useRef(new Float32Array(particleCount));
  const speeds = useRef(new Float32Array(particleCount));
  const targets = useRef<number[]>([]);
  const sources = useRef<number[]>([]);

  const callSignIndex = useMemo(() => new Map(agents.map((a, i) => [a.callSign, i])), [agents]);

  // Build activity-typed routes purely from real operational data
  const typedRoutes = useMemo(() => {
    const routes: { from: number; to: number; type: ActivityType }[] = [];
    const metricsMap = new Map(activityMetrics.map(m => [m.callSign, m]));
    const aegisIdx = callSignIndex.get("AEGIS-CMD");
    const activeAgents = new Set<number>();

    // 1. Comm links → message particles (green) — real agent-to-agent conversations/debates
    commLinks.forEach((link) => {
      const src = callSignIndex.get(link.sourceCallSign);
      const tgt = callSignIndex.get(link.targetCallSign);
      if (src !== undefined && tgt !== undefined) {
        const weight = Math.min(Math.ceil(link.messageCount / 3), 3);
        for (let w = 0; w < weight; w++) routes.push({ from: src, to: tgt, type: "message" });
        activeAgents.add(src);
        activeAgents.add(tgt);
      }
    });

    // 2. Scan pulses → scan_sweep particles (blue) — real autonomous scan results
    scanPulses.forEach((s) => {
      const srcIdx = callSignIndex.get(s.agentCallSign);
      if (srcIdx !== undefined && aegisIdx !== undefined) {
        routes.push({ from: srcIdx, to: aegisIdx, type: "scan_sweep" });
        activeAgents.add(srcIdx);
        // High-risk scans also generate alert particles
        if ((s.riskScore ?? 0) > 60) {
          routes.push({ from: srcIdx, to: aegisIdx, type: "alert" });
        }
      }
    });

    // 3. Per-agent metrics → signal_ingest (cyan) and alert (red) particles
    activityMetrics.forEach((m) => {
      const idx = callSignIndex.get(m.callSign);
      if (idx === undefined || aegisIdx === undefined) return;

      if (m.totalSignalsAnalyzed > 0) {
        // Cyan particles: signals being routed from command to this agent for analysis
        routes.push({ from: aegisIdx, to: idx, type: "signal_ingest" });
        activeAgents.add(idx);
      }
      if (m.totalAlertsGenerated > 0) {
        // Red particles: alerts escalated back to command
        routes.push({ from: idx, to: aegisIdx, type: "alert" });
        activeAgents.add(idx);
      }
    });

    // 4. Idle agents — agents with no recent activity get slow slate particles
    if (aegisIdx !== undefined) {
      agents.forEach((_, idx) => {
        if (idx !== aegisIdx && !activeAgents.has(idx)) {
          routes.push({ from: idx, to: aegisIdx, type: "idle" });
        }
      });
    }

    // 5. Minimum fallback — if absolutely no data, show idle heartbeat between random pairs (never index 0)
    if (routes.length === 0 && agents.length > 2) {
      for (let i = 1; i < Math.min(agents.length, 6); i++) {
        routes.push({ from: i, to: (i + 1) % agents.length || 1, type: "idle" });
      }
    }

    return routes;
  }, [agents, commLinks, activityMetrics, scanPulses, callSignIndex]);

  const { positions, colors, sizes } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    const sz = new Float32Array(particleCount);

    if (typedRoutes.length === 0) return { positions: pos, colors: col, sizes: sz };

    for (let i = 0; i < particleCount; i++) {
      const route = typedRoutes[i % typedRoutes.length];
      sources.current[i] = route.from;
      targets.current[i] = route.to;
      velocities.current[i] = Math.random();

      const visual = ACTIVITY_VISUALS[route.type];
      speeds.current[i] = visual.speed;

      const src = agents[route.from]?.position || [0, 0, 0];
      const tgt = agents[route.to]?.position || [0, 0, 0];
      const t = velocities.current[i];
      pos[i * 3] = src[0] + (tgt[0] - src[0]) * t;
      pos[i * 3 + 1] = src[1] + (tgt[1] - src[1]) * t;
      pos[i * 3 + 2] = src[2] + (tgt[2] - src[2]) * t;

      col[i * 3] = visual.color[0];
      col[i * 3 + 1] = visual.color[1];
      col[i * 3 + 2] = visual.color[2];
      sz[i] = visual.size;
    }
    return { positions: pos, colors: col, sizes: sz };
  }, [agents, typedRoutes]);

  useFrame((_, delta) => {
    if (!ref.current || agents.length === 0 || typedRoutes.length === 0) return;
    const posArr = ref.current.geometry.attributes.position.array as Float32Array;
    const colArr = ref.current.geometry.attributes.color.array as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      velocities.current[i] += delta * (speeds.current[i] + Math.random() * 0.02);

      if (velocities.current[i] >= 1) {
        velocities.current[i] = 0;
        const route = typedRoutes[Math.floor(Math.random() * typedRoutes.length)];
        sources.current[i] = route.from;
        targets.current[i] = route.to;
        const visual = ACTIVITY_VISUALS[route.type];
        speeds.current[i] = visual.speed;
        colArr[i * 3] = visual.color[0];
        colArr[i * 3 + 1] = visual.color[1];
        colArr[i * 3 + 2] = visual.color[2];
      }

      const src = agents[sources.current[i]]?.position || [0, 0, 0];
      const tgt = agents[targets.current[i]]?.position || [0, 0, 0];
      const t = velocities.current[i];
      posArr[i * 3] = src[0] + (tgt[0] - src[0]) * t;
      posArr[i * 3 + 1] = src[1] + (tgt[1] - src[1]) * t;
      posArr[i * 3 + 2] = src[2] + (tgt[2] - src[2]) * t;
    }

    ref.current.geometry.attributes.position.needsUpdate = true;
    ref.current.geometry.attributes.color.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={particleCount} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={particleCount} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial map={getGlowTexture()} size={0.7} vertexColors transparent opacity={0.95} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// Operator data flow particles — animated particles flowing between operator node and AEGIS
function OperatorDataFlow({ operatorPos, aegisPos, isActive, messageCount = 0 }: {
  operatorPos: [number, number, number];
  aegisPos: [number, number, number];
  isActive: boolean;
  messageCount: number;
}) {
  const particleCount = 15;
  const ref = useRef<THREE.Points>(null);
  const progressRef = useRef(new Float32Array(particleCount));
  const directionsRef = useRef(new Float32Array(particleCount));

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      progressRef.current[i] = Math.random();
      directionsRef.current[i] = i % 3 === 0 ? 1 : 0;
      const t = progressRef.current[i];
      const from = directionsRef.current[i] === 0 ? operatorPos : aegisPos;
      const to = directionsRef.current[i] === 0 ? aegisPos : operatorPos;
      pos[i * 3] = from[0] + (to[0] - from[0]) * t;
      pos[i * 3 + 1] = from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 0.8;
      pos[i * 3 + 2] = from[2] + (to[2] - from[2]) * t;
      if (directionsRef.current[i] === 0) {
        col[i * 3] = 0.13; col[i * 3 + 1] = 0.83; col[i * 3 + 2] = 0.93;
      } else {
        col[i * 3] = 0.96; col[i * 3 + 1] = 0.62; col[i * 3 + 2] = 0.04;
      }
    }
    return { positions: pos, colors: col };
  }, [operatorPos, aegisPos]);

  useFrame((_, delta) => {
    if (!ref.current || !isActive) return;
    const posArr = ref.current.geometry.attributes.position.array as Float32Array;
    const speed = 0.15 + Math.min(messageCount / 20, 0.3);
    for (let i = 0; i < particleCount; i++) {
      progressRef.current[i] += delta * (speed + Math.random() * 0.05);
      if (progressRef.current[i] >= 1) {
        progressRef.current[i] = 0;
        directionsRef.current[i] = Math.random() < 0.65 ? 0 : 1;
      }
      const t = progressRef.current[i];
      const from = directionsRef.current[i] === 0 ? operatorPos : aegisPos;
      const to = directionsRef.current[i] === 0 ? aegisPos : operatorPos;
      posArr[i * 3] = from[0] + (to[0] - from[0]) * t;
      posArr[i * 3 + 1] = from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 0.8;
      posArr[i * 3 + 2] = from[2] + (to[2] - from[2]) * t;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  if (!isActive) return null;

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={particleCount} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={particleCount} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial map={getGlowTexture()} size={0.4} vertexColors transparent opacity={0.9} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// Debate cluster ring
function DebateClusterRing({ agents, debate }: { agents: AgentNode[]; debate: ActiveDebate }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const participants = debate.participatingAgents;

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
    null
  );
}

// Convert lat/lng to 3D position on a sphere
function latLngToVector3(lat: number, lng: number, radius: number): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return [
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

// Known location coordinates for signal pins
const LOCATION_COORDS: Record<string, [number, number]> = {
  'british columbia': [53.7, -127.6],
  'bc': [53.7, -127.6],
  'vancouver': [49.28, -123.12],
  'montreal': [45.5, -73.57],
  'newfoundland': [48.5, -55.7],
  'venezuela': [6.42, -66.59],
  'austin': [30.27, -97.74],
  'pickering': [43.84, -79.09],
  'charlie lake': [56.3, -120.97],
  'hudson bay': [52.5, -79.5],
  'owen sound': [44.57, -80.94],
  'fire lake': [52.8, -66.6],
  'lake cowichan': [48.83, -124.05],
  'canada': [56.13, -106.35],
};

// Glowing pin on the globe surface
function SignalPin({ position, color, intensity = 1 }: {
  position: [number, number, number];
  color: string;
  intensity?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const phaseRef = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    phaseRef.current += delta * 2;
    const pulse = Math.sin(phaseRef.current);
    if (ref.current) {
      ref.current.scale.setScalar(1 + pulse * 0.3);
      (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.6 + pulse * 0.3;
    }
    if (beamRef.current) {
      beamRef.current.scale.y = 1 + pulse * 0.5;
      (beamRef.current.material as THREE.MeshBasicMaterial).opacity = 0.15 + pulse * 0.1;
    }
  });

  // Calculate beam direction (points away from globe center)
  const dir = new THREE.Vector3(...position).normalize();
  const beamPos: [number, number, number] = [
    position[0] + dir.x * 0.4,
    position[1] + dir.y * 0.4,
    position[2] + dir.z * 0.4,
  ];

  return (
    <group>
      {/* Pin dot */}
      <mesh ref={ref} position={position}>
        <sphereGeometry args={[0.12 * intensity, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>
      {/* Glow around pin */}
      <mesh position={position}>
        <sphereGeometry args={[0.25 * intensity, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
      {/* Light beam shooting up from pin */}
      <mesh ref={beamRef} position={beamPos} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)}>
        <cylinderGeometry args={[0.02, 0.06, 0.8, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

// Calculate real-time sun direction based on current UTC time
function getSunDirection(): THREE.Vector3 {
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const hourUTC = now.getUTCHours() + now.getUTCMinutes() / 60;

  // Solar declination (axial tilt effect)
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const decRad = declination * (Math.PI / 180);

  // Hour angle: sun is at longitude 0 at 12:00 UTC, rotates 15°/hr
  const hourAngle = (hourUTC - 12) * 15 * (Math.PI / 180);

  // Convert to 3D direction (sun position in Earth-centered frame)
  const x = Math.cos(decRad) * Math.sin(hourAngle);
  const y = Math.sin(decRad);
  const z = Math.cos(decRad) * Math.cos(hourAngle);

  return new THREE.Vector3(x, y, z).normalize();
}

// Earth with realistic real-time day/night cycle
function EarthGlobe({ position, signalLocations = [] }: {
  position: [number, number, number];
  signalLocations?: string[];
}) {
  const earthGroupRef = useRef<THREE.Group>(null);
  const earthRef = useRef<THREE.Mesh>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const nightRef = useRef<THREE.Mesh>(null);
  const sunLightRef = useRef<THREE.DirectionalLight>(null);
  const sunMeshRef = useRef<THREE.Group>(null);

  const [earthMap, bumpMap, nightMap, specularMap] = useTexture([
    '/textures/earth.jpg',
    '/textures/earth-bump.png',
    '/textures/earth-night.jpg',
    '/textures/earth-specular.png',
  ]);

  // Earth's axial tilt ~23.44°
  const axialTilt = 0.4091; // radians

  useFrame((_, delta) => {
    // Rotate Earth at realistic-feeling speed (1 rotation ~= 4 minutes for visual interest)
    const rotSpeed = delta * 0.025;
    if (earthGroupRef.current) earthGroupRef.current.rotation.y += rotSpeed;
    if (cloudsRef.current) cloudsRef.current.rotation.y += rotSpeed * 0.15; // clouds drift slightly faster than earth

    // Update sun position in real-time
    const sunDir = getSunDirection();
    const sunDist = 500;
    const sunPos = [sunDir.x * sunDist, sunDir.y * sunDist, sunDir.z * sunDist];
    if (sunLightRef.current) {
      sunLightRef.current.position.set(sunPos[0], sunPos[1], sunPos[2]);
    }
    if (sunMeshRef.current) {
      sunMeshRef.current.position.set(sunPos[0], sunPos[1], sunPos[2]);
    }
  });

  const earthRadius = 8;

  // Resolve signal locations to pins
  const pins = useMemo(() => {
    const seen = new Set<string>();
    const result: { pos: [number, number, number]; color: string }[] = [];
    signalLocations.forEach((loc) => {
      const key = loc.toLowerCase().trim();
      let coords = LOCATION_COORDS[key];
      if (!coords) {
        for (const [k, v] of Object.entries(LOCATION_COORDS)) {
          if (key.includes(k) || k.includes(key)) { coords = v; break; }
        }
      }
      if (coords && !seen.has(`${coords[0]},${coords[1]}`)) {
        seen.add(`${coords[0]},${coords[1]}`);
        result.push({
          pos: latLngToVector3(coords[0], coords[1], earthRadius * 1.01),
          color: '#f59e0b',
        });
      }
    });
    return result;
  }, [signalLocations, earthRadius]);

  // Initial sun direction for light placement
  const initialSunDir = useMemo(() => getSunDirection(), []);

  return (
    <group position={position}>
      {/* Real-time sunlight — tracks actual sun position */}
      <directionalLight
        ref={sunLightRef}
        position={[initialSunDir.x * 500, initialSunDir.y * 500, initialSunDir.z * 500]}
        intensity={3.0}
        color="#fffaf0"
      />
      {/* Very dim fill on the dark side */}
      <pointLight color="#112233" intensity={0.3} distance={40} position={[-initialSunDir.x * 20, -initialSunDir.y * 20, -initialSunDir.z * 20]} />

      {/* Realistic Sun body — distant and large */}
      <group ref={sunMeshRef} position={[initialSunDir.x * 500, initialSunDir.y * 500, initialSunDir.z * 500]}>
        <mesh>
          <sphereGeometry args={[50, 48, 48]} />
          <meshBasicMaterial color="#fff8e0" />
        </mesh>
        {/* Inner corona */}
        <mesh>
          <sphereGeometry args={[58, 32, 32]} />
          <meshBasicMaterial color="#ffee88" transparent opacity={0.12} side={THREE.BackSide} />
        </mesh>
        {/* Outer corona */}
        <mesh>
          <sphereGeometry args={[70, 24, 24]} />
          <meshBasicMaterial color="#ffdd66" transparent opacity={0.05} side={THREE.BackSide} />
        </mesh>
        {/* Distant glow haze */}
        <mesh>
          <sphereGeometry args={[90, 16, 16]} />
          <meshBasicMaterial color="#ffcc44" transparent opacity={0.02} side={THREE.BackSide} />
        </mesh>
        <pointLight color="#fff8e0" intensity={8} distance={600} />
      </group>

      {/* Rotating Earth group — earth, night lights, and signal pins all rotate together */}
      <group ref={earthGroupRef} rotation={[axialTilt, 0, 0]}>
        {/* Earth — day side with specular oceans */}
        <mesh ref={earthRef}>
          <sphereGeometry args={[earthRadius, 64, 64]} />
          <meshPhongMaterial
            map={earthMap}
            bumpMap={bumpMap}
            bumpScale={0.5}
            specularMap={specularMap}
            specular={new THREE.Color('#556677')}
            shininess={25}
          />
        </mesh>
        {/* Night side city lights — additive blending makes them glow only in shadow */}
        <mesh ref={nightRef}>
          <sphereGeometry args={[earthRadius * 1.001, 64, 64]} />
          <meshBasicMaterial
            map={nightMap}
            transparent
            opacity={0.7}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {/* Signal origin pins — rotate with the Earth */}
        {pins.map((pin, i) => (
          <SignalPin key={i} position={pin.pos} color={pin.color} />
        ))}
      </group>
      {/* Cloud layer — rotates slightly differently for visual depth */}
      <mesh ref={cloudsRef} rotation={[axialTilt, 0, 0]}>
        <sphereGeometry args={[earthRadius * 1.008, 48, 48]} />
        <meshPhongMaterial
          color="#ffffff"
          transparent
          opacity={0.15}
          depthWrite={false}
        />
      </mesh>
      {/* Thin atmospheric rim */}
      <mesh>
        <sphereGeometry args={[earthRadius * 1.025, 48, 48]} />
        <meshBasicMaterial color="#4499ff" transparent opacity={0.035} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

// Moon orbiting the Earth — realistic PBR lighting from the sun
function MoonBody({ earthPosition }: { earthPosition: [number, number, number] }) {
  const moonRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const moonMap = useTexture('/textures/moon.jpg');
  // Use the same texture as a bump map for crater relief
  const moonBump = useTexture('/textures/moon.jpg');
  const moonRadius = 2.2;
  const orbitRadius = 14;
  // ~5.14° orbital inclination
  const inclination = 5.14 * (Math.PI / 180);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 0.08;
    if (moonRef.current) {
      const x = Math.cos(t) * orbitRadius;
      const z = Math.sin(t) * orbitRadius * 0.9;
      const y = Math.sin(t) * orbitRadius * Math.sin(inclination);
      moonRef.current.position.set(
        earthPosition[0] + x,
        earthPosition[1] + y,
        earthPosition[2] + z
      );
    }
    // Slow synchronous rotation (tidally locked feel)
    if (meshRef.current) {
      meshRef.current.rotation.y = -t + Math.PI;
    }
  });

  return (
    <group ref={moonRef}>
      <mesh ref={meshRef} castShadow receiveShadow>
        <sphereGeometry args={[moonRadius, 64, 64]} />
        <meshStandardMaterial
          map={moonMap}
          bumpMap={moonBump}
          bumpScale={0.04}
          roughness={0.95}
          metalness={0.0}
          color="#c8c8c8"
        />
      </mesh>
    </group>
  );
}

// Knowledge Nebula — High-fidelity Hubble-style volumetric gas cloud
function KnowledgeNebula({ totalEntries = 0 }: { totalEntries: number }) {
  const nebulaRef = useRef<THREE.Group>(null);
  const layer1Ref = useRef<THREE.Points>(null);
  const layer2Ref = useRef<THREE.Points>(null);
  const layer3Ref = useRef<THREE.Points>(null);
  const layer4Ref = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Points>(null);
  const starsRef = useRef<THREE.Points>(null);
  const filamentRef = useRef<THREE.Points>(null);
  const pulseRef = useRef(0);
  const scale = Math.min(1 + totalEntries / 500, 3);

  // High-res soft cloud sprite with more natural falloff
  const cloudTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.08, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.18, "rgba(255,255,255,0.7)");
    gradient.addColorStop(0.3, "rgba(255,255,255,0.45)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.2)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.08)");
    gradient.addColorStop(0.8, "rgba(255,255,255,0.02)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
  }, []);

  // Wispy elongated cloud for filaments
  const wispTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    // Elongated elliptical gradient for wispy look
    ctx.save();
    ctx.translate(128, 128);
    ctx.scale(1, 0.4);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.2, "rgba(255,255,255,0.6)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.15)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(-128, -320, 256, 640);
    ctx.restore();
    return new THREE.CanvasTexture(canvas);
  }, []);

  // Sharp star sprite with diffraction spikes
  const starTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    // Core glow
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.05, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.15, "rgba(255,255,255,0.5)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    // Diffraction spikes
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(32, 2); ctx.lineTo(32, 62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 32); ctx.lineTo(62, 32); ctx.stroke();
    return new THREE.CanvasTexture(canvas);
  }, []);

  // Improved noise with octaves for organic detail
  const noise3D = (x: number, y: number, z: number) => {
    const p1 = Math.sin(x * 1.3 + y * 0.7) * Math.cos(z * 0.9 + x * 0.5) * Math.sin(y * 1.1 - z * 0.8);
    const p2 = Math.sin(x * 3.1 - z * 1.7) * Math.cos(y * 2.3 + x * 1.1) * 0.5;
    const p3 = Math.cos(x * 5.7 + y * 4.3) * Math.sin(z * 3.9) * 0.25;
    return (p1 + p2 + p3) * 0.35 + 0.5;
  };

  // Layer 1: Dense inner emission nebula — warm reds, oranges, pinks with pillar structures
  const { l1Pos, l1Col, l1Sizes, l1Count } = useMemo(() => {
    const count = 2400;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const arm = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.5) * 5.5 * scale;
      const pillar = noise3D(arm * 2, r * 0.5, i * 0.008);
      const tendril = noise3D(arm * 3.7, r * 1.2, i * 0.003);
      const x = Math.cos(arm) * r * (1 + pillar * 1.2) + (Math.random() - 0.5) * 1.0 * tendril;
      const y = (Math.random() - 0.5) * 4 * scale * (0.25 + pillar * 0.6);
      const z = Math.sin(arm) * r * (1 + pillar * 0.6) + (Math.random() - 0.5) * 0.8;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;

      // Rich color palette with more variation
      const colorSeed = noise3D(x * 0.3, y * 0.5, z * 0.4);
      if (colorSeed > 0.65) {
        // Deep crimson / dusty rose
        col[i * 3] = 0.85 + Math.random() * 0.15;
        col[i * 3 + 1] = 0.15 + Math.random() * 0.2;
        col[i * 3 + 2] = 0.2 + Math.random() * 0.15;
      } else if (colorSeed > 0.4) {
        // Warm amber / salmon
        col[i * 3] = 0.95 + Math.random() * 0.05;
        col[i * 3 + 1] = 0.45 + Math.random() * 0.25;
        col[i * 3 + 2] = 0.1 + Math.random() * 0.15;
      } else if (colorSeed > 0.2) {
        // Hot pink / magenta
        col[i * 3] = 0.9 + Math.random() * 0.1;
        col[i * 3 + 1] = 0.2 + Math.random() * 0.15;
        col[i * 3 + 2] = 0.5 + Math.random() * 0.3;
      } else {
        // Pale gold / peach
        col[i * 3] = 0.98;
        col[i * 3 + 1] = 0.7 + Math.random() * 0.2;
        col[i * 3 + 2] = 0.3 + Math.random() * 0.2;
      }
      // Vary particle size for depth — some very large diffuse, some tight
      sizes[i] = (0.6 + Math.random() * 2.0) * (0.5 + pillar * 0.8);
    }
    return { l1Pos: pos, l1Col: col, l1Sizes: sizes, l1Count: count };
  }, [scale]);

  // Layer 2: Outer reflection nebula — blues, teals, purples, larger and more diffuse
  const { l2Pos, l2Col, l2Sizes, l2Count } = useMemo(() => {
    const count = 1800;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const arm = Math.random() * Math.PI * 2;
      const r = 2 + Math.pow(Math.random(), 0.4) * 7 * scale;
      const wisp = noise3D(arm * 1.5, r * 0.3, i * 0.005);
      const x = Math.cos(arm) * r + (Math.random() - 0.5) * 2.5 * wisp;
      const y = (Math.random() - 0.5) * 5 * scale * (0.3 + wisp * 0.4);
      const z = Math.sin(arm) * r + (Math.random() - 0.5) * 2;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;

      const mix = Math.random();
      if (mix < 0.35) {
        // Deep sapphire blue
        col[i * 3] = 0.1 + Math.random() * 0.1;
        col[i * 3 + 1] = 0.25 + Math.random() * 0.25;
        col[i * 3 + 2] = 0.85 + Math.random() * 0.15;
      } else if (mix < 0.6) {
        // Teal / cyan
        col[i * 3] = 0.05 + Math.random() * 0.15;
        col[i * 3 + 1] = 0.5 + Math.random() * 0.35;
        col[i * 3 + 2] = 0.7 + Math.random() * 0.2;
      } else if (mix < 0.8) {
        // Purple / violet
        col[i * 3] = 0.4 + Math.random() * 0.35;
        col[i * 3 + 1] = 0.1 + Math.random() * 0.15;
        col[i * 3 + 2] = 0.75 + Math.random() * 0.25;
      } else {
        // Indigo transition
        col[i * 3] = 0.2 + Math.random() * 0.15;
        col[i * 3 + 1] = 0.15 + Math.random() * 0.15;
        col[i * 3 + 2] = 0.6 + Math.random() * 0.3;
      }
      sizes[i] = 1.0 + Math.random() * 2.8;
    }
    return { l2Pos: pos, l2Col: col, l2Sizes: sizes, l2Count: count };
  }, [scale]);

  // Layer 3: Dark dust lanes — creates silhouette pillars and depth
  const { l3Pos, l3Col, l3Sizes, l3Count } = useMemo(() => {
    const count = 600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const pillar = Math.floor(Math.random() * 7);
      const baseAngle = (pillar / 7) * Math.PI * 2 + 0.2;
      const baseR = 1.2 + Math.random() * 3.0;
      const pillarNoise = noise3D(pillar * 2.1, baseR * 0.8, i * 0.01);
      const x = Math.cos(baseAngle) * baseR * scale + (Math.random() - 0.5) * 1.2 * pillarNoise;
      const y = (Math.random() - 0.5) * 5 * scale * (0.3 + pillarNoise * 0.4);
      const z = Math.sin(baseAngle) * baseR * scale + (Math.random() - 0.5) * 1.0;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      // Very dark — absorbs light
      const darkness = 0.03 + Math.random() * 0.08;
      col[i * 3] = darkness * 1.5;
      col[i * 3 + 1] = darkness * 0.8;
      col[i * 3 + 2] = darkness * 0.5;
      sizes[i] = 1.5 + Math.random() * 2.5;
    }
    return { l3Pos: pos, l3Col: col, l3Sizes: sizes, l3Count: count };
  }, [scale]);

  // Layer 4: Wispy edge filaments — tendrils extending outward
  const { l4Pos, l4Col, l4Count } = useMemo(() => {
    const count = 800;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Create tendril-like extensions from the main body
      const tendrilId = Math.floor(Math.random() * 12);
      const tendrilAngle = (tendrilId / 12) * Math.PI * 2;
      const progress = Math.pow(Math.random(), 0.7);
      const r = 4 + progress * 6 * scale;
      const spread = progress * 2.5;
      const x = Math.cos(tendrilAngle) * r + (Math.random() - 0.5) * spread;
      const y = (Math.random() - 0.5) * 2 * (1 - progress * 0.5);
      const z = Math.sin(tendrilAngle) * r + (Math.random() - 0.5) * spread;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      // Fade from warm to cool at edges
      const fade = 1 - progress;
      col[i * 3] = 0.7 * fade + 0.15 * (1 - fade);
      col[i * 3 + 1] = 0.3 * fade + 0.3 * (1 - fade);
      col[i * 3 + 2] = 0.4 * fade + 0.7 * (1 - fade);
    }
    return { l4Pos: pos, l4Col: col, l4Count: count };
  }, [scale]);

  // Core: Ultra-bright hot region
  const { corePos, coreCol, coreCount } = useMemo(() => {
    const count = 250;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.pow(Math.random(), 1.8) * 2.5 * scale;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.35;
      pos[i * 3 + 2] = r * Math.cos(phi);
      // White-hot to pale yellow
      col[i * 3] = 1.0;
      col[i * 3 + 1] = 0.9 + Math.random() * 0.1;
      col[i * 3 + 2] = 0.85 + Math.random() * 0.15;
    }
    return { corePos: pos, coreCol: col, coreCount: count };
  }, [scale]);

  // Embedded young stars
  const { starPos, starCol, starCount } = useMemo(() => {
    const count = 120;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 0.5 + Math.random() * 7 * scale;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.3;
      pos[i * 3 + 2] = r * Math.cos(phi);
      const temp = Math.random();
      if (temp > 0.7) {
        // Hot blue-white O/B type
        col[i * 3] = 0.8; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 1.0;
      } else if (temp > 0.4) {
        // White A type
        col[i * 3] = 1.0; col[i * 3 + 1] = 0.98; col[i * 3 + 2] = 0.95;
      } else {
        // Yellow-orange young star
        col[i * 3] = 1.0; col[i * 3 + 1] = 0.85; col[i * 3 + 2] = 0.6;
      }
    }
    return { starPos: pos, starCol: col, starCount: count };
  }, [scale]);

  useFrame((_, delta) => {
    pulseRef.current += delta * 0.25;
    const pulse = Math.sin(pulseRef.current);
    const pulse2 = Math.sin(pulseRef.current * 0.6 + 1.5);
    const pulse3 = Math.sin(pulseRef.current * 1.3 + 0.8);
    if (nebulaRef.current) nebulaRef.current.rotation.y += delta * 0.006;
    if (layer1Ref.current) {
      (layer1Ref.current.material as THREE.PointsMaterial).opacity = 0.22 + pulse * 0.04;
      layer1Ref.current.rotation.y += delta * 0.002;
    }
    if (layer2Ref.current) {
      (layer2Ref.current.material as THREE.PointsMaterial).opacity = 0.12 + pulse2 * 0.03;
      layer2Ref.current.rotation.y -= delta * 0.003;
      layer2Ref.current.rotation.z += delta * 0.001;
    }
    if (layer3Ref.current) {
      (layer3Ref.current.material as THREE.PointsMaterial).opacity = 0.45 + pulse * 0.06;
    }
    if (layer4Ref.current) {
      (layer4Ref.current.material as THREE.PointsMaterial).opacity = 0.08 + pulse3 * 0.03;
      layer4Ref.current.rotation.y += delta * 0.001;
    }
    if (coreRef.current) {
      (coreRef.current.material as THREE.PointsMaterial).opacity = 0.5 + pulse * 0.12;
      coreRef.current.rotation.y += delta * 0.008;
    }
    if (starsRef.current) {
      (starsRef.current.material as THREE.PointsMaterial).opacity = 0.75 + pulse2 * 0.15;
    }
  });

  return (
    <group ref={nebulaRef} position={[0, 18, -5]}>
      {/* Layer 1: Dense inner emission gas */}
      <points ref={layer1Ref}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={l1Count} array={l1Pos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={l1Count} array={l1Col} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={1.6} vertexColors transparent opacity={0.22} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} map={cloudTexture} />
      </points>

      {/* Layer 2: Outer reflection gas */}
      <points ref={layer2Ref}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={l2Count} array={l2Pos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={l2Count} array={l2Col} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={2.2} vertexColors transparent opacity={0.12} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} map={cloudTexture} />
      </points>

      {/* Layer 3: Dark dust lanes */}
      <points ref={layer3Ref}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={l3Count} array={l3Pos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={l3Count} array={l3Col} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={2.8} vertexColors transparent opacity={0.45} sizeAttenuation depthWrite={false} blending={THREE.NormalBlending} map={cloudTexture} />
      </points>

      {/* Layer 4: Wispy edge filaments */}
      <points ref={layer4Ref}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={l4Count} array={l4Pos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={l4Count} array={l4Col} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={1.4} vertexColors transparent opacity={0.08} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} map={wispTexture} />
      </points>

      {/* Core: Hot bright center emission */}
      <points ref={coreRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={coreCount} array={corePos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={coreCount} array={coreCol} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={1.0} vertexColors transparent opacity={0.5} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} map={cloudTexture} />
      </points>

      {/* Embedded young stars with diffraction spikes */}
      <points ref={starsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={starCount} array={starPos} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={starCount} array={starCol} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.3} vertexColors transparent opacity={0.75} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} map={starTexture} />
      </points>

      {/* Volumetric glow shells for overall luminosity */}
      <mesh>
        <sphereGeometry args={[2.5 * scale, 32, 32]} />
        <meshBasicMaterial color="#e8553a" transparent opacity={0.035} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[4 * scale, 32, 32]} />
        <meshBasicMaterial color="#c026d3" transparent opacity={0.02} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[6 * scale, 24, 24]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.012} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[8 * scale, 16, 16]} />
        <meshBasicMaterial color="#6366f1" transparent opacity={0.006} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Multi-color lighting for richness */}
      <pointLight color="#f97316" intensity={2.2} distance={30} />
      <pointLight color="#ec4899" intensity={1.5} distance={35} position={[1, 1, 0]} />
      <pointLight color="#a855f7" intensity={0.8} distance={25} position={[-2, 0, 1]} />
      <pointLight color="#3b82f6" intensity={0.6} distance={45} position={[3, -1, -3]} />
    </group>
  );
}

// Learning Particle Streams — violet particles flowing from Knowledge Nebula to agents that are actively learning
function LearningParticleStreams({ agents, activelyLearningAgents = [] }: {
  agents: AgentNode[];
  activelyLearningAgents: string[];
}) {
  const particleCount = 40;
  const ref = useRef<THREE.Points>(null);
  const progressRef = useRef(new Float32Array(particleCount));
  const targetsRef = useRef<number[]>([]);

  const nebulaPos: [number, number, number] = [0, 18, -5];

  const learningAgentIndices = useMemo(() => {
    const indices = agents
      .map((a, i) => activelyLearningAgents.includes(a.callSign) ? i : -1)
      .filter(i => i >= 0);
    // No ambient fallback — only stream particles when agents are actively learning
    return indices;
  }, [agents, activelyLearningAgents]);

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const col = new Float32Array(particleCount * 3);
    if (learningAgentIndices.length === 0) return { positions: pos, colors: col };
    for (let i = 0; i < particleCount; i++) {
      const targetIdx = learningAgentIndices[i % learningAgentIndices.length];
      targetsRef.current[i] = targetIdx;
      progressRef.current[i] = Math.random();
      const t = progressRef.current[i];
      const tgt = agents[targetIdx]?.position || [0, 0, 0];
      pos[i * 3] = nebulaPos[0] + (tgt[0] - nebulaPos[0]) * t;
      pos[i * 3 + 1] = nebulaPos[1] + (tgt[1] - nebulaPos[1]) * t;
      pos[i * 3 + 2] = nebulaPos[2] + (tgt[2] - nebulaPos[2]) * t;
      col[i * 3] = 0.66;
      col[i * 3 + 1] = 0.33;
      col[i * 3 + 2] = 0.97;
    }
    return { positions: pos, colors: col };
  }, [agents, learningAgentIndices]);

  useFrame((_, delta) => {
    if (!ref.current || agents.length === 0 || learningAgentIndices.length === 0) return;
    const posArr = ref.current.geometry.attributes.position.array as Float32Array;
    const speed = 0.12;

    for (let i = 0; i < particleCount; i++) {
      progressRef.current[i] += delta * (speed + Math.random() * 0.04);
      if (progressRef.current[i] >= 1) {
        progressRef.current[i] = 0;
        targetsRef.current[i] = learningAgentIndices[Math.floor(Math.random() * learningAgentIndices.length)];
      }
      const t = progressRef.current[i];
      const tgt = agents[targetsRef.current[i]]?.position || [0, 0, 0];
      const arcHeight = Math.sin(t * Math.PI) * 3;
      posArr[i * 3] = nebulaPos[0] + (tgt[0] - nebulaPos[0]) * t + Math.sin(t * 4 + i) * 0.3;
      posArr[i * 3 + 1] = nebulaPos[1] + (tgt[1] - nebulaPos[1]) * t + arcHeight;
      posArr[i * 3 + 2] = nebulaPos[2] + (tgt[2] - nebulaPos[2]) * t + Math.cos(t * 4 + i) * 0.3;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  if (learningAgentIndices.length === 0) return null;

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={particleCount} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={particleCount} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial map={getGlowTexture()} size={0.5} vertexColors transparent opacity={0.9} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// Neural Synapse Flashes — electric pulses that ripple across connection lines when knowledge propagates
function SynapseFlashes({ agents, commLinks = [], todayEntries = 0 }: {
  agents: AgentNode[];
  commLinks?: AgentCommLink[];
  todayEntries: number;
}) {
  const flashCount = Math.min(todayEntries, 8);
  const groupRef = useRef<THREE.Group>(null);
  const flashRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flashProgress = useRef<number[]>([]);
  const flashRoutes = useRef<{ from: number; to: number }[]>([]);

  const callSignIndex = useMemo(() => new Map(agents.map((a, i) => [a.callSign, i])), [agents]);

  // Build routes from comm links
  const routes = useMemo(() => {
    const r: { from: number; to: number }[] = [];
    commLinks.forEach(link => {
      const src = callSignIndex.get(link.sourceCallSign);
      const tgt = callSignIndex.get(link.targetCallSign);
      if (src !== undefined && tgt !== undefined) r.push({ from: src, to: tgt });
    });
    return r.length > 0 ? r : agents.map((_, i) => ({ from: 0, to: i }));
  }, [agents, commLinks, callSignIndex]);

  // Initialize flash data
  useMemo(() => {
    flashProgress.current = Array.from({ length: flashCount }, () => Math.random());
    flashRoutes.current = Array.from({ length: flashCount }, (_, i) => routes[i % routes.length] || { from: 0, to: 0 });
  }, [flashCount, routes]);

  useFrame((_, delta) => {
    if (agents.length === 0 || flashCount === 0) return;
    for (let i = 0; i < flashCount; i++) {
      flashProgress.current[i] += delta * (0.8 + Math.random() * 0.4);
      if (flashProgress.current[i] >= 1) {
        flashProgress.current[i] = 0;
        flashRoutes.current[i] = routes[Math.floor(Math.random() * routes.length)] || { from: 0, to: 0 };
      }
      const mesh = flashRefs.current[i];
      if (mesh) {
        const route = flashRoutes.current[i];
        const src = agents[route.from]?.position || [0, 0, 0];
        const tgt = agents[route.to]?.position || [0, 0, 0];
        const t = flashProgress.current[i];
        mesh.position.set(
          src[0] + (tgt[0] - src[0]) * t,
          src[1] + (tgt[1] - src[1]) * t,
          src[2] + (tgt[2] - src[2]) * t
        );
        // Flash brightness peaks at center of travel
        const brightness = Math.sin(t * Math.PI);
        mesh.scale.setScalar(0.1 + brightness * 0.25);
        (mesh.material as THREE.MeshBasicMaterial).opacity = brightness * 0.9;
      }
    }
  });

  if (flashCount === 0) return null;

  return (
    <group ref={groupRef}>
      {Array.from({ length: flashCount }, (_, i) => (
        <mesh key={`synapse-${i}`} ref={(el) => { flashRefs.current[i] = el; }}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color="#e0e7ff" transparent opacity={0} />
        </mesh>
      ))}
    </group>
  );
}

// Fortification rings — concentric rings around each agent showing fortress layer depth
// Ring 1: Observability (cyan) | Ring 2: Safety (amber) | Ring 3: Reliability (green) | Ring 4: Learning (purple)
function FortificationRings({ agents, fortressHealth }: { agents: AgentNode[]; fortressHealth?: FortressHealth }) {
  const groupRef = useRef<THREE.Group>(null);

  const layerData = useMemo(() => {
    if (!fortressHealth) return { obs: 0, saf: 0, rel: 0, lrn: 0 };
    const loops = fortressHealth.loops;
    const pct = (layer: string) => {
      const layerLoops = loops.filter((l) => l.layer === layer);
      if (layerLoops.length === 0) return 0;
      return layerLoops.filter((l) => l.status === "closed").length / layerLoops.length;
    };
    return {
      obs: pct("observability"),
      saf: pct("safety"),
      rel: pct("reliability"),
      lrn: pct("learning"),
    };
  }, [fortressHealth]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.03;
    }
  });

  if (!fortressHealth) return null;

  const ringConfigs = [
    { pct: layerData.obs, color: "#22d3ee", radius: 1.1, label: "OBS" },
    { pct: layerData.saf, color: "#f59e0b", radius: 1.4, label: "SEC" },
    { pct: layerData.rel, color: "#10b981", radius: 1.7, label: "REL" },
    { pct: layerData.lrn, color: "#a855f7", radius: 2.0, label: "LRN" },
  ];

  return (
    <group ref={groupRef}>
      {agents.filter((a) => a.tier === "primary" || a.callSign === "AEGIS-CMD").map((agent) => {
        const size = agent.callSign === "AEGIS-CMD" ? 1.0 : 0.6;
        return (
          <group key={`fort-${agent.id}`} position={agent.position}>
            {/* armor rings removed */}
          </group>
        );
      })}
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
  activityMetrics = [],
  knowledgeGraphEdges = [],
  operatorDevices = [],
  operatorMessageActivity,
  signalLocations = [],
  knowledgeGrowth,
  fortressHealth,
  showBattle = true,
}: ConstellationSceneProps) {
  const [cameraView, setCameraView] = useState<CameraView>("constellation");
  const controlsRef = useRef<any>(null);

  const handleClick = useCallback((agent: AgentNode) => { onNodeClick?.(agent); }, [onNodeClick]);
  const [hoveredAgent, setHoveredAgent] = useState<AgentNode | null>(null);

  const visibleAgents = isExecutiveMode
    ? agents.filter((a) => a.tier === "primary" || a.tier === "secondary")
    : agents;

  const debatingAgents = useMemo(() => {
    const set = new Set<string>();
    activeDebates.forEach((d) => d.participatingAgents.forEach((a) => set.add(a)));
    return set;
  }, [activeDebates]);

  // Build activity score lookup
  const activityMap = useMemo(() => {
    const map = new Map<string, number>();
    activityMetrics.forEach((m) => map.set(m.callSign, m.activityScore));
    return map;
  }, [activityMetrics]);

  const earthPosition: [number, number, number] = [-35, -15, -40];

  return (
    <div className="relative w-full h-full">
      {/* Camera view buttons */}
      <div className="absolute top-14 right-4 z-20 flex flex-col gap-2">
        {([
          { view: "constellation" as CameraView, label: "⬡ NETWORK", desc: "Agent constellation" },
          { view: "earth" as CameraView, label: "🌍 EARTH", desc: "Globe view" },
          { view: "cinematic" as CameraView, label: "🎬 CINEMATIC", desc: "Auto flythrough" },
        ]).map(({ view, label, desc }) => (
          <button
            key={view}
            onClick={() => setCameraView(view)}
            className={`px-3 py-2 rounded border text-left transition-all duration-300 backdrop-blur-xl ${
              cameraView === view
                ? "bg-primary/20 border-primary/50 text-primary"
                : "bg-card/50 border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
            }`}
          >
            <div className="text-[11px] font-bold tracking-widest">{label}</div>
            <div className="text-[9px] opacity-60">{desc}</div>
          </button>
        ))}
      </div>

      <Canvas
        camera={{ position: [0, 2, 20], fov: 55 }}
        style={{ background: "#020408" }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
        }}
      >
        <CameraController view={cameraView} controlsRef={controlsRef} />

        <ambientLight intensity={0.15} />

        <directionalLight position={[-70, 20, -80]} intensity={1.5} color="#fffaf0" />
        <DeepSpaceField neutralizedCount={neutralizedCount} />
        <ShootingStars />
        <MilkyWayBand />
        <PlanetParade />
        <AsteroidBelt />
        <Comets />

        {/* Star Wars Endor Battle — agent-driven battle */}
        {showBattle && <EndorBattle agents={agents.map(a => ({ callSign: a.callSign, specialty: a.specialty }))} />}

        {/* Knowledge Nebula — cosmic source of intelligence above the constellation */}
        <KnowledgeNebula totalEntries={knowledgeGrowth?.totalEntries || 0} />

        {/* Learning particle streams — violet particles from nebula to learning agents */}
        <LearningParticleStreams
          agents={visibleAgents}
          activelyLearningAgents={knowledgeGrowth?.activelyLearningAgents || []}
        />

        {/* Neural synapse flashes — electric pulses across connections when knowledge grows */}
        <SynapseFlashes
          agents={visibleAgents}
          commLinks={commLinks}
          todayEntries={knowledgeGrowth?.todayEntries || 0}
        />

        {/* Earth & Moon — background celestial bodies */}
        <EarthGlobe position={earthPosition} signalLocations={signalLocations} />
        <MoonBody earthPosition={earthPosition} />
        


        <ConnectionLines agents={visibleAgents} commLinks={commLinks} activityMetrics={activityMetrics} />
        <SignalParticles agents={visibleAgents} commLinks={commLinks} activityMetrics={activityMetrics} scanPulses={scanPulses} />

        {/* Knowledge graph overlay — dashed colored arcs */}
        {!isExecutiveMode && knowledgeGraphEdges.length > 0 && (
          <KnowledgeGraphOverlay agents={visibleAgents} edges={knowledgeGraphEdges} />
        )}

        {/* Incident heat trails — severity-colored particles */}
        <IncidentHeatTrails agents={visibleAgents} activeDebates={activeDebates} scanPulses={scanPulses} />

        {/* Debate cluster rings */}
        {activeDebates.map((debate) => (
          <DebateClusterRing key={debate.id} agents={visibleAgents} debate={debate} />
        ))}

        {/* Performance halos */}
        {visibleAgents.map((agent) => {
          const score = activityMap.get(agent.callSign) || 0;
          const size = agent.tier === "primary" ? 0.6 : agent.tier === "secondary" ? 0.38 : 0.22;
          return (
            <PerformanceHalo
              key={`halo-${agent.id}`}
              position={agent.position}
              activityScore={score}
              color={agent.color}
              size={size}
            />
          );
        })}

        {/* Fortification rings — fortress layer depth per node */}
        {!isExecutiveMode && (
          <FortificationRings agents={visibleAgents} fortressHealth={fortressHealth} />
        )}

        {/* AEGIS Command Hub — unique central node */}
        {visibleAgents.filter((a) => a.callSign === "AEGIS-CMD").map((agent) => (
          <AegisCommandHub
            key={agent.id}
            agent={agent}
            onClick={() => handleClick(agent)}
            activityScore={activityMap.get(agent.callSign) || 0}
            onHover={setHoveredAgent}
            onUnhover={() => setHoveredAgent(null)}
          />
        ))}

        {/* Connected Operator Device */}
        {(() => {
          const operatorPos: [number, number, number] = [14, -3, 5];
          const aegisAgent = visibleAgents.find((a) => a.callSign === "AEGIS-CMD");
          const aegisPos: [number, number, number] = (aegisAgent?.position || [0, 0, 0]) as [number, number, number];
          const hasOnlineDevices = operatorDevices.length > 0;
          const hasMessages = operatorMessageActivity?.hasRecentMessages || false;
          const msgCount = operatorMessageActivity?.recentMessageCount || 0;
          const isActive = hasOnlineDevices || hasMessages;
          return (
            <>
              <OperatorDeviceNode position={operatorPos} isOnline={hasOnlineDevices} deviceCount={operatorDevices.length} hasMessageActivity={hasMessages} />
              <Line
                points={[new THREE.Vector3(...aegisPos), new THREE.Vector3(...operatorPos)]}
                color={isActive ? (hasMessages ? "#22d3ee" : "#10b981") : "#334155"}
                transparent
                opacity={isActive ? 0.5 : 0.12}
                lineWidth={isActive ? 1.5 : 0.5}
              />
              <OperatorDataFlow
                operatorPos={operatorPos}
                aegisPos={aegisPos}
                isActive={isActive}
                messageCount={msgCount}
              />
            </>
          );
        })()}

        {/* Agent nodes (non-AEGIS) */}
        {visibleAgents.filter((a) => a.callSign !== "AEGIS-CMD").map((agent) => (
          <AgentSphere
            key={agent.id}
            agent={agent}
            onClick={() => handleClick(agent)}
            isInDebate={debatingAgents.has(agent.callSign)}
            activityScore={activityMap.get(agent.callSign) || 0}
            onHover={setHoveredAgent}
            onUnhover={() => setHoveredAgent(null)}
          />
        ))}

        <OrbitControls
          ref={controlsRef}
          enablePan
          enableZoom
          minDistance={1}
          maxDistance={600}
          autoRotate={cameraView === "constellation"}
          autoRotateSpeed={0.2}
          dampingFactor={0.05}
          enableDamping
          panSpeed={1.2}
        />



      </Canvas>
    </div>
  );
}

export type { AgentNode };
