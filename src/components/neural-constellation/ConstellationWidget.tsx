import { useNavigate } from "react-router-dom";
import { Brain, ArrowRight } from "lucide-react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useMemo } from "react";
import * as THREE from "three";

// Mini star field for the widget
function MiniStars() {
  const ref = useRef<THREE.Points>(null);
  const count = 200;

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    return pos;
  }, []);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.02;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.08} color="#22d3ee" transparent opacity={0.5} sizeAttenuation />
    </points>
  );
}

// Mini nodes
function MiniNodes() {
  const groupRef = useRef<THREE.Group>(null);
  const colors = ["#7C3AED", "#22d3ee", "#F97316", "#2ECC71", "#3B82F6", "#9B59B6"];

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.15;
  });

  return (
    <group ref={groupRef}>
      {colors.map((color, i) => {
        const angle = (i / colors.length) * Math.PI * 2;
        const r = 3;
        return (
          <mesh key={i} position={[Math.cos(angle) * r, Math.sin(angle) * r * 0.5, Math.sin(angle)]}>
            <sphereGeometry args={[0.25, 16, 16]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

export function ConstellationWidget() {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/neural-constellation")}
      className="group relative bg-card/60 backdrop-blur border border-border rounded-lg overflow-hidden hover:border-primary/40 transition-all duration-300 w-full h-32"
    >
      {/* 3D mini constellation */}
      <div className="absolute inset-0 opacity-60 group-hover:opacity-90 transition-opacity">
        <Canvas camera={{ position: [0, 0, 8], fov: 50 }} gl={{ alpha: true }}>
          <ambientLight intensity={0.3} />
          <MiniStars />
          <MiniNodes />
        </Canvas>
      </div>

      {/* Overlay content */}
      <div className="absolute inset-0 flex items-end p-3 bg-gradient-to-t from-card/90 via-transparent to-transparent">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-foreground tracking-wider">
              Neural Constellation
            </span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
      </div>
    </button>
  );
}
