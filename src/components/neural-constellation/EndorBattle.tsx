/**
 * Full Endor Battle — ambient Star Wars-style space battle background
 * Features: Movie-accurate Star Destroyers, Mon Calamari cruisers, Death Star,
 * fighters, pooled turbolaser bolts, explosions.
 * Laser colors: Rebels fire RED, Empire fires GREEN (movie-accurate).
 */
import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════
//  SHIP GEOMETRY BUILDERS
// ═══════════════════════════════════════════════════════════════

function createStarDestroyerGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();

  // Main dagger wedge hull
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, 3.0);       // Nose tip
  hullShape.lineTo(-1.6, -2.0);   // Port rear
  // Engine notches (port side)
  hullShape.lineTo(-1.4, -2.3);
  hullShape.lineTo(-1.0, -2.1);
  hullShape.lineTo(-0.8, -2.4);
  hullShape.lineTo(-0.4, -2.2);
  hullShape.lineTo(0, -2.5);      // Center rear
  // Engine notches (starboard side)
  hullShape.lineTo(0.4, -2.2);
  hullShape.lineTo(0.8, -2.4);
  hullShape.lineTo(1.0, -2.1);
  hullShape.lineTo(1.4, -2.3);
  hullShape.lineTo(1.6, -2.0);    // Starboard rear
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.35, bevelEnabled: false });
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.scale(1.5, 0.25, 1.5);

  // T-shaped command tower (bridge)
  const towerBase = new THREE.BoxGeometry(0.3, 0.8, 0.25);
  towerBase.translate(0, 0.55, -1.8);

  // Bridge horizontal bar (T crosspiece)
  const towerBar = new THREE.BoxGeometry(1.2, 0.2, 0.2);
  towerBar.translate(0, 0.95, -1.8);

  // Shield generator domes (two small spheres on bridge)
  const domL = new THREE.SphereGeometry(0.12, 6, 6);
  domL.translate(-0.4, 1.1, -1.8);
  const domR = new THREE.SphereGeometry(0.12, 6, 6);
  domR.translate(0.4, 1.1, -1.8);

  // Surface panel detail lines (thin boxes along hull)
  const panel1 = new THREE.BoxGeometry(0.05, 0.02, 3.5);
  panel1.translate(-0.5, 0.13, -0.2);
  const panel2 = new THREE.BoxGeometry(0.05, 0.02, 3.5);
  panel2.translate(0.5, 0.13, -0.2);
  const panel3 = new THREE.BoxGeometry(2.0, 0.02, 0.05);
  panel3.translate(0, 0.13, -0.8);

  // Merge all into one geometry
  const merged = new THREE.BufferGeometry();
  const geos = [hullGeo, towerBase, towerBar, domL, domR, panel1, panel2, panel3];
  // Use mergeBufferGeometries equivalent
  const positions: number[] = [];
  const normals: number[] = [];
  for (const g of geos) {
    const posArr = g.attributes.position.array;
    const normArr = g.attributes.normal.array;
    for (let i = 0; i < posArr.length; i++) {
      positions.push(posArr[i]);
      normals.push(normArr[i]);
    }
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeBoundingSphere();

  return merged;
}

function createMonCalGeometry(): THREE.BufferGeometry {
  // Elongated organic hull with lateral pod bulges and bridge dome
  const positions: number[] = [];
  const normals: number[] = [];

  function addGeo(g: THREE.BufferGeometry) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) {
      positions.push(p[i]);
      normals.push(n[i]);
    }
  }

  // Main elongated hull body
  const hull = new THREE.SphereGeometry(1, 10, 8);
  hull.scale(2.5, 0.55, 0.9);
  addGeo(hull);

  // Lateral pod bulge (port)
  const podL = new THREE.SphereGeometry(0.5, 6, 6);
  podL.scale(1.0, 0.8, 1.2);
  podL.translate(0.3, 0, -0.9);
  addGeo(podL);

  // Lateral pod bulge (starboard)
  const podR = new THREE.SphereGeometry(0.5, 6, 6);
  podR.scale(1.0, 0.8, 1.2);
  podR.translate(0.3, 0, 0.9);
  addGeo(podR);

  // Bridge dome (top, towards front)
  const bridge = new THREE.SphereGeometry(0.3, 6, 6);
  bridge.scale(1.0, 0.6, 0.8);
  bridge.translate(1.0, 0.5, 0);
  addGeo(bridge);

  // Multi-engine cluster (rear) — 5 small spheres
  for (let i = 0; i < 5; i++) {
    const eng = new THREE.SphereGeometry(0.18, 5, 5);
    const angle = (i / 5) * Math.PI * 2;
    eng.translate(-2.4, Math.sin(angle) * 0.3, Math.cos(angle) * 0.3);
    addGeo(eng);
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeBoundingSphere();
  return merged;
}

function createFighterGeometry(isXWing: boolean): THREE.BufferGeometry {
  if (isXWing) {
    const geo = new THREE.BoxGeometry(0.1, 0.02, 0.15);
    return geo;
  }
  const geo = new THREE.BoxGeometry(0.12, 0.12, 0.04);
  return geo;
}

// ═══════════════════════════════════════════════════════════════
//  DEATH STAR
// ═══════════════════════════════════════════════════════════════

function DeathStar({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const laserRef = useRef<THREE.Mesh>(null);
  const firingRef = useRef(0);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.02;
    firingRef.current += delta;
    const cycle = firingRef.current % 12;
    const isFiring = cycle < 0.8;
    if (laserRef.current) {
      (laserRef.current.material as THREE.MeshBasicMaterial).opacity = isFiring ? 0.7 + Math.sin(firingRef.current * 30) * 0.3 : 0;
      laserRef.current.scale.x = isFiring ? 1 : 0;
    }
    if (glowRef.current) {
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = isFiring ? 0.15 : 0.04;
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh>
        <sphereGeometry args={[5, 24, 24]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.8} metalness={0.4} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.02, 0.15, 4, 32]} />
        <meshStandardMaterial color="#222222" roughness={0.9} />
      </mesh>
      <mesh position={[2, 2.5, 3.2]} rotation={[0.3, 0.8, 0]}>
        <circleGeometry args={[1.5, 16]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.95} />
      </mesh>
      <mesh ref={glowRef} position={[2, 2.5, 3.5]}>
        <sphereGeometry args={[1.8, 12, 12]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0.04} />
      </mesh>
      <mesh ref={laserRef} position={[2, 2.5, 15]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.1, 25, 6]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0} />
      </mesh>
      <pointLight color="#666666" intensity={1} distance={30} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CAPITAL SHIPS
// ═══════════════════════════════════════════════════════════════

interface CapitalShipProps {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  isImperial: boolean;
  index: number;
}

function CapitalShip({ position, rotation, isImperial, index }: CapitalShipProps) {
  const ref = useRef<THREE.Group>(null);
  const driftSpeed = useRef(0.1 + Math.random() * 0.15);
  const driftPhase = useRef(Math.random() * Math.PI * 2);

  const geometry = useMemo(() =>
    isImperial ? createStarDestroyerGeometry() : createMonCalGeometry(),
    [isImperial]
  );

  const color = isImperial ? "#8899aa" : "#aa7755";
  const emissiveColor = isImperial ? "#334466" : "#553322";

  useFrame((_, delta) => {
    if (!ref.current) return;
    driftPhase.current += delta * driftSpeed.current;
    ref.current.position.x = position.x + Math.sin(driftPhase.current + index) * 0.5;
    ref.current.position.y = position.y + Math.cos(driftPhase.current * 0.7 + index * 2) * 0.3;
    ref.current.position.z = position.z + Math.sin(driftPhase.current * 0.5) * 0.4;
    ref.current.rotation.z = rotation.z + Math.sin(driftPhase.current * 0.3) * 0.03;
  });

  return (
    <group ref={ref} position={position} rotation={rotation}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={0.3}
          roughness={0.6}
          metalness={0.7}
        />
      </mesh>
      {/* Engine glow — Mon Cal gets multi-engine cluster glow */}
      {isImperial ? (
        <>
          {/* SD triple engine bank */}
          {[-0.4, 0, 0.4].map((zOff, ei) => (
            <mesh key={ei} position={[0, 0, -1.5 * 1.5 + zOff * 0.5]}>
              <sphereGeometry args={[0.25, 6, 6]} />
              <meshBasicMaterial color="#6688ff" transparent opacity={0.5} />
            </mesh>
          ))}
        </>
      ) : (
        <>
          {/* Mon Cal 5-engine cluster */}
          {Array.from({ length: 5 }, (_, i) => {
            const angle = (i / 5) * Math.PI * 2;
            return (
              <mesh key={i} position={[-2.4, Math.sin(angle) * 0.3, Math.cos(angle) * 0.3]}>
                <sphereGeometry args={[0.15, 5, 5]} />
                <meshBasicMaterial color="#ff8844" transparent opacity={0.6} />
              </mesh>
            );
          })}
        </>
      )}
      <pointLight
        color={isImperial ? "#4466cc" : "#ff6633"}
        intensity={0.5}
        distance={8}
      />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  FIGHTER SWARMS (instanced for performance)
// ═══════════════════════════════════════════════════════════════

interface FighterData {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  faction: "rebel" | "imperial";
  alive: boolean;
  fireCooldown: number;
  bankAngle: number;
  evadeTimer: number;
}

const FIGHTER_COUNT = 80;
const BATTLE_CENTER: [number, number, number] = [0, 15, -45];
const BATTLE_RADIUS = 25;

function FighterSwarm({ laserCallback }: { laserCallback: (from: THREE.Vector3, to: THREE.Vector3, color: string) => void }) {
  const rebelRef = useRef<THREE.InstancedMesh>(null);
  const imperialRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const fighters = useRef<FighterData[]>([]);

  useMemo(() => {
    fighters.current = Array.from({ length: FIGHTER_COUNT }, (_, i) => {
      const isRebel = i < FIGHTER_COUNT / 2;
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * BATTLE_RADIUS;
      const y = (Math.random() - 0.5) * 15;
      return {
        position: new THREE.Vector3(
          BATTLE_CENTER[0] + Math.cos(angle) * r,
          BATTLE_CENTER[1] + y,
          BATTLE_CENTER[2] + Math.sin(angle) * r,
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5),
          (Math.random() - 0.5) * 2,
        ),
        target: new THREE.Vector3(),
        faction: isRebel ? "rebel" : "imperial",
        alive: true,
        fireCooldown: Math.random() * 3,
        bankAngle: 0,
        evadeTimer: 0,
      };
    });
  }, []);

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.05);
    const rebels = fighters.current.filter(f => f.faction === "rebel" && f.alive);
    const imperials = fighters.current.filter(f => f.faction === "imperial" && f.alive);

    fighters.current.forEach((fighter) => {
      if (!fighter.alive) return;
      const enemies = fighter.faction === "rebel" ? imperials : rebels;
      let nearest = enemies[0];
      let nearestDist = Infinity;
      for (const enemy of enemies) {
        const d = fighter.position.distanceTo(enemy.position);
        if (d < nearestDist) { nearestDist = d; nearest = enemy; }
      }
      if (nearest) {
        fighter.target.copy(nearest.position);
        fighter.target.addScaledVector(nearest.velocity, 0.5);
      }
      const toTarget = new THREE.Vector3().subVectors(fighter.target, fighter.position);
      const dist = toTarget.length();
      toTarget.normalize();
      fighter.evadeTimer -= clampedDelta;
      if (fighter.evadeTimer <= 0) {
        fighter.evadeTimer = 1 + Math.random() * 3;
        toTarget.x += (Math.random() - 0.5) * 0.8;
        toTarget.y += (Math.random() - 0.5) * 0.5;
        toTarget.z += (Math.random() - 0.5) * 0.8;
        toTarget.normalize();
      }
      const speed = fighter.faction === "rebel" ? 6 : 5.5;
      fighter.velocity.lerp(toTarget.multiplyScalar(speed), clampedDelta * 2);
      fighter.position.addScaledVector(fighter.velocity, clampedDelta);
      const fromCenter = new THREE.Vector3(
        fighter.position.x - BATTLE_CENTER[0],
        fighter.position.y - BATTLE_CENTER[1],
        fighter.position.z - BATTLE_CENTER[2],
      );
      if (fromCenter.length() > BATTLE_RADIUS * 1.5) {
        fromCenter.normalize().multiplyScalar(-2);
        fighter.velocity.add(fromCenter);
      }
      // Fire lasers — movie-accurate: Rebels=RED, Empire=GREEN
      fighter.fireCooldown -= clampedDelta;
      if (fighter.fireCooldown <= 0 && dist < 15 && nearest) {
        fighter.fireCooldown = 0.3 + Math.random() * 0.8;
        const laserEnd = fighter.position.clone().addScaledVector(
          new THREE.Vector3().subVectors(nearest.position, fighter.position).normalize(),
          Math.min(dist, 8),
        );
        laserCallback(
          fighter.position.clone(),
          laserEnd,
          fighter.faction === "rebel" ? "#ff2222" : "#22ff44",
        );
      }
      const cross = new THREE.Vector3().crossVectors(fighter.velocity.clone().normalize(), toTarget);
      fighter.bankAngle = THREE.MathUtils.lerp(fighter.bankAngle, cross.y * 1.5, clampedDelta * 3);
    });

    let rebelIdx = 0;
    let imperialIdx = 0;
    fighters.current.forEach((fighter) => {
      if (!fighter.alive) return;
      dummy.position.copy(fighter.position);
      if (fighter.velocity.lengthSq() > 0.01) {
        dummy.lookAt(fighter.position.clone().add(fighter.velocity));
      }
      dummy.rotateZ(fighter.bankAngle);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      if (fighter.faction === "rebel" && rebelRef.current) {
        rebelRef.current.setMatrixAt(rebelIdx++, dummy.matrix);
      } else if (fighter.faction === "imperial" && imperialRef.current) {
        imperialRef.current.setMatrixAt(imperialIdx++, dummy.matrix);
      }
    });

    if (rebelRef.current) {
      rebelRef.current.count = rebelIdx;
      rebelRef.current.instanceMatrix.needsUpdate = true;
    }
    if (imperialRef.current) {
      imperialRef.current.count = imperialIdx;
      imperialRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  const rebelGeo = useMemo(() => createFighterGeometry(true), []);
  const imperialGeo = useMemo(() => createFighterGeometry(false), []);

  return (
    <>
      <instancedMesh ref={rebelRef} args={[rebelGeo, undefined, FIGHTER_COUNT / 2]}>
        <meshStandardMaterial color="#cccccc" emissive="#ff6644" emissiveIntensity={0.5} roughness={0.4} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={imperialRef} args={[imperialGeo, undefined, FIGHTER_COUNT / 2]}>
        <meshStandardMaterial color="#555566" emissive="#4466aa" emissiveIntensity={0.5} roughness={0.5} metalness={0.7} />
      </instancedMesh>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
//  LASER BOLTS (pooled for performance — fighter lasers)
// ═══════════════════════════════════════════════════════════════

interface LaserBolt {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  life: number;
  maxLife: number;
  active: boolean;
}

const MAX_LASERS = 120;

function LaserBolts({ lasersRef }: { lasersRef: React.MutableRefObject<LaserBolt[]> }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((_, delta) => {
    lasersRef.current.forEach((laser, i) => {
      if (!laser.active) return;
      laser.life += delta;
      if (laser.life >= laser.maxLife) {
        laser.active = false;
        const mesh = meshRefs.current[i];
        if (mesh) mesh.visible = false;
        return;
      }
      const mesh = meshRefs.current[i];
      if (!mesh) return;
      const progress = laser.life / laser.maxLife;
      const currentPos = new THREE.Vector3().lerpVectors(laser.from, laser.to, progress);
      const dir = new THREE.Vector3().subVectors(laser.to, laser.from).normalize();
      mesh.position.copy(currentPos);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      mesh.visible = true;
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - progress * 0.5;
    });
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: MAX_LASERS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => { meshRefs.current[i] = el; }}
          visible={false}
        >
          <cylinderGeometry args={[0.02, 0.02, 0.6, 3]} />
          <meshBasicMaterial
            color={lasersRef.current[i]?.color || "#ff2222"}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  EXPLOSIONS (particle bursts)
// ═══════════════════════════════════════════════════════════════

function ExplosionParticles() {
  const ref = useRef<THREE.Points>(null);
  const PARTICLE_COUNT = 200;
  const particles = useRef<{
    positions: Float32Array;
    velocities: Float32Array;
    lifetimes: Float32Array;
    colors: Float32Array;
  }>({
    positions: new Float32Array(PARTICLE_COUNT * 3),
    velocities: new Float32Array(PARTICLE_COUNT * 3),
    lifetimes: new Float32Array(PARTICLE_COUNT),
    colors: new Float32Array(PARTICLE_COUNT * 3),
  });

  const spawnExplosion = useCallback((pos: THREE.Vector3) => {
    const p = particles.current;
    let spawned = 0;
    for (let i = 0; i < PARTICLE_COUNT && spawned < 15; i++) {
      if (p.lifetimes[i] <= 0) {
        p.positions[i * 3] = pos.x;
        p.positions[i * 3 + 1] = pos.y;
        p.positions[i * 3 + 2] = pos.z;
        p.velocities[i * 3] = (Math.random() - 0.5) * 8;
        p.velocities[i * 3 + 1] = (Math.random() - 0.5) * 8;
        p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 8;
        p.lifetimes[i] = 0.5 + Math.random() * 0.8;
        const heat = Math.random();
        p.colors[i * 3] = 1;
        p.colors[i * 3 + 1] = 0.3 + heat * 0.6;
        p.colors[i * 3 + 2] = heat * 0.3;
        spawned++;
      }
    }
  }, []);

  const timer = useRef(0);
  useFrame((_, delta) => {
    timer.current += delta;
    if (timer.current > 0.8 + Math.random() * 1.5) {
      timer.current = 0;
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 20;
      spawnExplosion(new THREE.Vector3(
        BATTLE_CENTER[0] + Math.cos(angle) * r,
        BATTLE_CENTER[1] + (Math.random() - 0.5) * 10,
        BATTLE_CENTER[2] + Math.sin(angle) * r,
      ));
    }
    const p = particles.current;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (p.lifetimes[i] <= 0) continue;
      p.lifetimes[i] -= delta;
      p.positions[i * 3] += p.velocities[i * 3] * delta;
      p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * delta;
      p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * delta;
      p.velocities[i * 3] *= 0.97;
      p.velocities[i * 3 + 1] *= 0.97;
      p.velocities[i * 3 + 2] *= 0.97;
    }
    if (ref.current) {
      const geom = ref.current.geometry;
      geom.attributes.position.needsUpdate = true;
      geom.attributes.color.needsUpdate = true;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={PARTICLE_COUNT} array={particles.current.positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={PARTICLE_COUNT} array={particles.current.colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.3} vertexColors transparent opacity={0.9} sizeAttenuation />
    </points>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TURBOLASER BOLTS — POOLED IMPERATIVE SYSTEM
//  Bolts physically travel from one capital ship to another.
//  Empire fires GREEN, Rebels fire RED (movie-accurate).
// ═══════════════════════════════════════════════════════════════

interface TurboBolt {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
  life: number;
  maxLife: number;
  active: boolean;
}

const MAX_TURBO_BOLTS = 60;

function TurbolaserExchanges({ imperialPositions, rebelPositions }: {
  imperialPositions: THREE.Vector3[];
  rebelPositions: THREE.Vector3[];
}) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

  const bolts = useRef<TurboBolt[]>(
    Array.from({ length: MAX_TURBO_BOLTS }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      color: "#22ff44",
      life: 0,
      maxLife: 1.5,
      active: false,
    }))
  );

  const fireTimer = useRef(0);

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.05);

    // Spawn new bolts periodically
    fireTimer.current += clampedDelta;
    if (fireTimer.current > 0.12 + Math.random() * 0.15) {
      fireTimer.current = 0;

      if (imperialPositions.length > 0 && rebelPositions.length > 0) {
        // Alternate sides, fire 1-2 bolts at a time
        const count = Math.random() > 0.6 ? 2 : 1;
        for (let b = 0; b < count; b++) {
          const bolt = bolts.current.find(bl => !bl.active);
          if (!bolt) break;

          const imperialFires = Math.random() > 0.45; // Slight imperial bias
          const sources = imperialFires ? imperialPositions : rebelPositions;
          const targets = imperialFires ? rebelPositions : imperialPositions;

          const from = sources[Math.floor(Math.random() * sources.length)].clone();
          const to = targets[Math.floor(Math.random() * targets.length)].clone();

          // Offset from hull surface randomly
          from.add(new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 3
          ));
          // Slight inaccuracy on target
          to.add(new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 2
          ));

          const dir = new THREE.Vector3().subVectors(to, from);
          const dist = dir.length();
          dir.normalize();

          const speed = 30 + Math.random() * 15; // Fast bolts
          bolt.position.copy(from);
          bolt.velocity.copy(dir).multiplyScalar(speed);
          bolt.maxLife = dist / speed + 0.1; // Enough time to reach target
          bolt.life = 0;
          bolt.active = true;
          // Movie-accurate: Empire=GREEN, Rebels=RED
          bolt.color = imperialFires ? "#22ff44" : "#ff2222";
        }
      }
    }

    // Update active bolts
    bolts.current.forEach((bolt, i) => {
      const mesh = meshRefs.current[i];
      if (!bolt.active) {
        if (mesh) mesh.visible = false;
        return;
      }

      bolt.life += clampedDelta;
      if (bolt.life >= bolt.maxLife) {
        bolt.active = false;
        if (mesh) mesh.visible = false;
        return;
      }

      // Move bolt
      bolt.position.addScaledVector(bolt.velocity, clampedDelta);

      if (mesh) {
        mesh.position.copy(bolt.position);
        // Orient along velocity
        const dir = bolt.velocity.clone().normalize();
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mesh.visible = true;

        const mat = mesh.material as THREE.MeshBasicMaterial;
        // Fade out near end of life
        const remaining = 1 - bolt.life / bolt.maxLife;
        mat.opacity = Math.min(remaining * 4, 0.95);
        mat.color.set(bolt.color);
      }
    });
  });

  return (
    <group>
      {Array.from({ length: MAX_TURBO_BOLTS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => { meshRefs.current[i] = el; }}
          visible={false}
        >
          <cylinderGeometry args={[0.05, 0.05, 1.2, 4]} />
          <meshBasicMaterial color="#22ff44" transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN BATTLE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

export function EndorBattle() {
  const lasersRef = useRef<LaserBolt[]>(
    Array.from({ length: MAX_LASERS }, () => ({
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      color: "#ff2222",
      life: 0,
      maxLife: 0.3,
      active: false,
    }))
  );

  const laserCallback = useCallback((from: THREE.Vector3, to: THREE.Vector3, color: string) => {
    const laser = lasersRef.current.find(l => !l.active);
    if (laser) {
      laser.from.copy(from);
      laser.to.copy(to);
      laser.color = color;
      laser.life = 0;
      laser.maxLife = 0.2 + Math.random() * 0.15;
      laser.active = true;
    }
  }, []);

  const imperialShips = useMemo(() => [
    { pos: new THREE.Vector3(BATTLE_CENTER[0] + 25, BATTLE_CENTER[1] + 5, BATTLE_CENTER[2] - 10), rot: new THREE.Euler(0, -0.8, 0.05) },
    { pos: new THREE.Vector3(BATTLE_CENTER[0] + 20, BATTLE_CENTER[1] - 3, BATTLE_CENTER[2] + 15), rot: new THREE.Euler(0, -1.2, -0.03) },
    { pos: new THREE.Vector3(BATTLE_CENTER[0] + 30, BATTLE_CENTER[1] + 2, BATTLE_CENTER[2] + 5), rot: new THREE.Euler(0, -0.5, 0.02) },
  ], []);

  const rebelShips = useMemo(() => [
    { pos: new THREE.Vector3(BATTLE_CENTER[0] - 20, BATTLE_CENTER[1] - 2, BATTLE_CENTER[2] + 8), rot: new THREE.Euler(0, 0.6, -0.04) },
    { pos: new THREE.Vector3(BATTLE_CENTER[0] - 18, BATTLE_CENTER[1] + 4, BATTLE_CENTER[2] - 12), rot: new THREE.Euler(0, 1.0, 0.03) },
  ], []);

  const imperialPositions = useMemo(() => imperialShips.map(s => s.pos), [imperialShips]);
  const rebelPositions = useMemo(() => rebelShips.map(s => s.pos), [rebelShips]);

  return (
    <group>
      <DeathStar position={[BATTLE_CENTER[0] + 50, BATTLE_CENTER[1] + 15, BATTLE_CENTER[2] - 30]} />

      {imperialShips.map((ship, i) => (
        <CapitalShip key={`imp-${i}`} position={ship.pos} rotation={ship.rot} isImperial={true} index={i} />
      ))}

      {rebelShips.map((ship, i) => (
        <CapitalShip key={`reb-${i}`} position={ship.pos} rotation={ship.rot} isImperial={false} index={i + 10} />
      ))}

      <FighterSwarm laserCallback={laserCallback} />
      <LaserBolts lasersRef={lasersRef} />
      <TurbolaserExchanges imperialPositions={imperialPositions} rebelPositions={rebelPositions} />
      <ExplosionParticles />

      <pointLight position={BATTLE_CENTER} color="#ff6633" intensity={0.8} distance={50} />
      <pointLight position={[BATTLE_CENTER[0] + 20, BATTLE_CENTER[1], BATTLE_CENTER[2]]} color="#4466ff" intensity={0.4} distance={30} />
    </group>
  );
}
