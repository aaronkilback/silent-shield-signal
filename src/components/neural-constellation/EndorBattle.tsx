/**
 * Full Endor Battle — ambient Star Wars-style space battle background
 * Plays behind the agent constellation as a decorative, ever-changing scene.
 * Features: Star Destroyers, Mon Calamari cruisers, Death Star, fighters, lasers, explosions.
 */
import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════
//  SHIP GEOMETRY BUILDERS (low-poly silhouettes)
// ═══════════════════════════════════════════════════════════════

// Simple geometry merge helper
function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geometries) {
    totalVerts += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : g.attributes.position.count;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices: number[] = [];
  let vertOffset = 0;
  for (const g of geometries) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      positions[(vertOffset + i) * 3] = pos.getX(i);
      positions[(vertOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertOffset + i) * 3 + 2] = pos.getZ(i);
      if (norm) {
        normals[(vertOffset + i) * 3] = norm.getX(i);
        normals[(vertOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vertOffset + i) * 3 + 2] = norm.getZ(i);
      }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices.push(g.index.getX(i) + vertOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(i + vertOffset);
      }
    }
    vertOffset += pos.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

function createStarDestroyerGeometry(): THREE.BufferGeometry {
  // Iconic wedge — triangular from top, with bridge tower bump
  const shape = new THREE.Shape();
  shape.moveTo(0, 3.5);
  shape.lineTo(-2.0, -2.5);
  shape.lineTo(-1.8, -3.0);
  shape.lineTo(-0.4, -3.2);
  shape.lineTo(0, -2.8);
  shape.lineTo(0.4, -3.2);
  shape.lineTo(1.8, -3.0);
  shape.lineTo(2.0, -2.5);
  shape.closePath();
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.04, bevelSegments: 1 });
  hull.rotateX(Math.PI / 2);
  hull.scale(2.0, 0.35, 2.0);
  // Bridge tower
  const tower = new THREE.BoxGeometry(1.2, 1.0, 0.6);
  tower.translate(0, 0.7, -2.5);
  const bridge = new THREE.BoxGeometry(1.8, 0.15, 0.9);
  bridge.translate(0, 1.25, -2.5);
  return mergeBufferGeometries([hull, tower, bridge]);
}

function createMonCalGeometry(): THREE.BufferGeometry {
  // Organic bulbous cruiser — elongated
  const geo = new THREE.SphereGeometry(1.2, 12, 10);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const scaleFactor = 1.0 - Math.abs(z) * 0.12;
    pos.setX(i, pos.getX(i) * 2.5 * scaleFactor);
    pos.setY(i, pos.getY(i) * 0.8);
    pos.setZ(i, z * 1.6);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  // Add engine block
  const engines = new THREE.CylinderGeometry(0.4, 0.5, 0.6, 8);
  engines.rotateX(Math.PI / 2);
  engines.translate(0, 0, -2.0);
  return mergeBufferGeometries([geo, engines]);
}

function createXWingGeometry(): THREE.BufferGeometry {
  // X-Wing: fuselage + 4 wing planes in X pattern
  const fuselage = new THREE.BoxGeometry(0.12, 0.08, 0.6);
  const nose = new THREE.ConeGeometry(0.06, 0.25, 4);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0, 0.42);
  // 4 wings
  const wingGeo = () => new THREE.BoxGeometry(0.55, 0.02, 0.3);
  const w1 = wingGeo(); w1.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.3)); w1.translate(0.15, 0.08, -0.05);
  const w2 = wingGeo(); w2.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.3)); w2.translate(-0.15, 0.08, -0.05);
  const w3 = wingGeo(); w3.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI + 0.3)); w3.translate(0.15, -0.08, -0.05);
  const w4 = wingGeo(); w4.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI - 0.3)); w4.translate(-0.15, -0.08, -0.05);
  // Engine pods at wing tips
  const eng1 = new THREE.CylinderGeometry(0.025, 0.03, 0.15, 4); eng1.rotateX(Math.PI/2); eng1.translate(0.38, 0.12, -0.15);
  const eng2 = new THREE.CylinderGeometry(0.025, 0.03, 0.15, 4); eng2.rotateX(Math.PI/2); eng2.translate(-0.38, 0.12, -0.15);
  const eng3 = new THREE.CylinderGeometry(0.025, 0.03, 0.15, 4); eng3.rotateX(Math.PI/2); eng3.translate(0.38, -0.12, -0.15);
  const eng4 = new THREE.CylinderGeometry(0.025, 0.03, 0.15, 4); eng4.rotateX(Math.PI/2); eng4.translate(-0.38, -0.12, -0.15);
  return mergeBufferGeometries([fuselage, nose, w1, w2, w3, w4, eng1, eng2, eng3, eng4]);
}

function createTIEGeometry(): THREE.BufferGeometry {
  // TIE Fighter: sphere cockpit + hexagonal wing panels + struts
  const cockpit = new THREE.SphereGeometry(0.08, 6, 6);
  const panel1 = new THREE.CircleGeometry(0.22, 6);
  panel1.rotateY(Math.PI / 2); panel1.translate(0.18, 0, 0);
  const panel1b = new THREE.CircleGeometry(0.22, 6);
  panel1b.rotateY(-Math.PI / 2); panel1b.translate(0.18, 0, 0);
  const panel2 = new THREE.CircleGeometry(0.22, 6);
  panel2.rotateY(-Math.PI / 2); panel2.translate(-0.18, 0, 0);
  const panel2b = new THREE.CircleGeometry(0.22, 6);
  panel2b.rotateY(Math.PI / 2); panel2b.translate(-0.18, 0, 0);
  const strut1 = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 4);
  strut1.rotateZ(Math.PI / 2); strut1.translate(0.09, 0, 0);
  const strut2 = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 4);
  strut2.rotateZ(Math.PI / 2); strut2.translate(-0.09, 0, 0);
  return mergeBufferGeometries([cockpit, panel1, panel1b, panel2, panel2b, strut1, strut2]);
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
    // Superlaser fires every ~12 seconds for 0.8s
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
    <group ref={ref} position={position} scale={[2.5, 2.5, 2.5]}>
      {/* Main sphere */}
      <mesh>
        <sphereGeometry args={[5, 24, 24]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.8} metalness={0.4} emissive="#111111" emissiveIntensity={0.3} />
      </mesh>
      {/* Equatorial trench */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.02, 0.2, 6, 32]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
      {/* Superlaser dish */}
      <mesh position={[2, 2.5, 3.2]} rotation={[0.3, 0.8, 0]}>
        <circleGeometry args={[1.5, 16]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.95} />
      </mesh>
      {/* Superlaser glow */}
      <mesh ref={glowRef} position={[2, 2.5, 3.5]}>
        <sphereGeometry args={[1.8, 12, 12]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0.04} />
      </mesh>
      {/* Superlaser beam */}
      <mesh ref={laserRef} position={[2, 2.5, 20]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.15, 35, 6]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0} />
      </mesh>
      {/* Ambient light */}
      <pointLight color="#888888" intensity={3} distance={80} />
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
    // Gentle drift
    ref.current.position.x = position.x + Math.sin(driftPhase.current + index) * 0.5;
    ref.current.position.y = position.y + Math.cos(driftPhase.current * 0.7 + index * 2) * 0.3;
    ref.current.position.z = position.z + Math.sin(driftPhase.current * 0.5) * 0.4;
    // Slow roll
    ref.current.rotation.z = rotation.z + Math.sin(driftPhase.current * 0.3) * 0.03;
  });

  const shipScale = isImperial ? 3.0 : 2.5;

  return (
    <group ref={ref} position={position} rotation={rotation} scale={[shipScale, shipScale, shipScale]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial 
          color={color} 
          emissive={emissiveColor} 
          emissiveIntensity={0.5}
          roughness={0.5}
          metalness={0.8}
        />
      </mesh>
      {/* Engine glow — multiple engines for Star Destroyers */}
      {isImperial ? (
        <>
          {[-0.8, -0.3, 0.3, 0.8].map((x, i) => (
            <mesh key={i} position={[x, 0, -5.5]}>
              <sphereGeometry args={[0.35, 8, 8]} />
              <meshBasicMaterial color="#6699ff" transparent opacity={0.6} />
            </mesh>
          ))}
        </>
      ) : (
        <mesh position={[0, 0, -2.2]}>
          <sphereGeometry args={[0.8, 8, 8]} />
          <meshBasicMaterial color="#ff8844" transparent opacity={0.5} />
        </mesh>
      )}
      <pointLight 
        color={isImperial ? "#4466cc" : "#ff6633"} 
        intensity={2} 
        distance={25} 
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
const BATTLE_CENTER: [number, number, number] = [0, 8, -80];
const BATTLE_RADIUS = 40;

function FighterSwarm({ laserCallback }: { laserCallback: (from: THREE.Vector3, to: THREE.Vector3, color: string) => void }) {
  const rebelRef = useRef<THREE.InstancedMesh>(null);
  const imperialRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const fighters = useRef<FighterData[]>([]);

  // Initialize fighters
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

      // Pick nearest enemy as target
      const enemies = fighter.faction === "rebel" ? imperials : rebels;
      let nearest = enemies[0];
      let nearestDist = Infinity;
      for (const enemy of enemies) {
        const d = fighter.position.distanceTo(enemy.position);
        if (d < nearestDist) { nearestDist = d; nearest = enemy; }
      }

      if (nearest) {
        fighter.target.copy(nearest.position);
        // Pursuit with some lead
        fighter.target.addScaledVector(nearest.velocity, 0.5);
      }

      // Steering
      const toTarget = new THREE.Vector3().subVectors(fighter.target, fighter.position);
      const dist = toTarget.length();
      toTarget.normalize();

      // Add some chaos
      fighter.evadeTimer -= clampedDelta;
      if (fighter.evadeTimer <= 0) {
        fighter.evadeTimer = 1 + Math.random() * 3;
        // Random jink
        toTarget.x += (Math.random() - 0.5) * 0.8;
        toTarget.y += (Math.random() - 0.5) * 0.5;
        toTarget.z += (Math.random() - 0.5) * 0.8;
        toTarget.normalize();
      }

      const speed = fighter.faction === "rebel" ? 6 : 5.5;
      fighter.velocity.lerp(toTarget.multiplyScalar(speed), clampedDelta * 2);
      fighter.position.addScaledVector(fighter.velocity, clampedDelta);

      // Keep in battle area
      const fromCenter = new THREE.Vector3(
        fighter.position.x - BATTLE_CENTER[0],
        fighter.position.y - BATTLE_CENTER[1],
        fighter.position.z - BATTLE_CENTER[2],
      );
      if (fromCenter.length() > BATTLE_RADIUS * 1.5) {
        fromCenter.normalize().multiplyScalar(-2);
        fighter.velocity.add(fromCenter);
      }

      // Fire lasers
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
          fighter.faction === "rebel" ? "#ff3333" : "#33ff33",
        );
      }

      // Bank angle for visual flair
      const cross = new THREE.Vector3().crossVectors(fighter.velocity.clone().normalize(), toTarget);
      fighter.bankAngle = THREE.MathUtils.lerp(fighter.bankAngle, cross.y * 1.5, clampedDelta * 3);
    });

    // Update instanced meshes
    let rebelIdx = 0;
    let imperialIdx = 0;
    fighters.current.forEach((fighter) => {
      if (!fighter.alive) return;
      dummy.position.copy(fighter.position);
      // Orient along velocity
      if (fighter.velocity.lengthSq() > 0.01) {
        dummy.lookAt(fighter.position.clone().add(fighter.velocity));
      }
      dummy.rotateZ(fighter.bankAngle);
      dummy.scale.setScalar(3.5);
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

  const rebelGeo = useMemo(() => createXWingGeometry(), []);
  const imperialGeo = useMemo(() => createTIEGeometry(), []);

  return (
    <>
      <instancedMesh ref={rebelRef} args={[rebelGeo, undefined, FIGHTER_COUNT / 2]}>
        <meshStandardMaterial color="#dddddd" emissive="#ff6644" emissiveIntensity={0.6} roughness={0.3} metalness={0.7} />
      </instancedMesh>
      <instancedMesh ref={imperialRef} args={[imperialGeo, undefined, FIGHTER_COUNT / 2]}>
        <meshStandardMaterial color="#667788" emissive="#4466cc" emissiveIntensity={0.6} roughness={0.4} metalness={0.8} />
      </instancedMesh>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
//  LASER BOLTS (pooled for performance)
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
          <cylinderGeometry args={[0.06, 0.06, 1.2, 4]} />
          <meshBasicMaterial 
            color={lasersRef.current[i]?.color || "#ff3333"} 
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
    lifetimes: new Float32Array(PARTICLE_COUNT), // life remaining
    colors: new Float32Array(PARTICLE_COUNT * 3),
  });

  const spawnExplosion = useCallback((pos: THREE.Vector3) => {
    const p = particles.current;
    // Find 15 dead particles and respawn
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
        // Orange-yellow-white
        const heat = Math.random();
        p.colors[i * 3] = 1;
        p.colors[i * 3 + 1] = 0.3 + heat * 0.6;
        p.colors[i * 3 + 2] = heat * 0.3;
        spawned++;
      }
    }
  }, []);

  // Random explosions at battle area
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
      // Slow down
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
//  TURBOLASER EXCHANGES (capital ship to capital ship)
// ═══════════════════════════════════════════════════════════════

function TurbolaserExchanges({ imperialPositions, rebelPositions }: {
  imperialPositions: THREE.Vector3[];
  rebelPositions: THREE.Vector3[];
}) {
  const beamsRef = useRef<THREE.Group>(null);
  const beams = useRef<{ from: THREE.Vector3; to: THREE.Vector3; life: number; color: string }[]>([]);
  const timer = useRef(0);

  useFrame((_, delta) => {
    timer.current += delta;
    
    // Fire turbolasers every ~0.4s
    if (timer.current > 0.3 + Math.random() * 0.3) {
      timer.current = 0;
      if (imperialPositions.length > 0 && rebelPositions.length > 0) {
        const fromSide = Math.random() > 0.5;
        const sources = fromSide ? imperialPositions : rebelPositions;
        const targets = fromSide ? rebelPositions : imperialPositions;
        const from = sources[Math.floor(Math.random() * sources.length)].clone();
        const to = targets[Math.floor(Math.random() * targets.length)].clone();
        // Add randomness
        from.add(new THREE.Vector3((Math.random()-0.5)*3, (Math.random()-0.5)*2, (Math.random()-0.5)*3));
        to.add(new THREE.Vector3((Math.random()-0.5)*3, (Math.random()-0.5)*2, (Math.random()-0.5)*3));
        beams.current.push({
          from, to,
          life: 0.4 + Math.random() * 0.3,
          color: fromSide ? "#33ff66" : "#ff4444",
        });
      }
    }

    // Decay beams
    beams.current = beams.current.filter(b => {
      b.life -= delta;
      return b.life > 0;
    });
  });

  return (
    <group ref={beamsRef}>
      {beams.current.slice(0, 20).map((beam, i) => {
        const dir = new THREE.Vector3().subVectors(beam.to, beam.from);
        const mid = new THREE.Vector3().addVectors(beam.from, beam.to).multiplyScalar(0.5);
        const length = dir.length();
        dir.normalize();
        return (
          <mesh key={i} position={mid} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), dir)}>
            <cylinderGeometry args={[0.15, 0.15, length, 4]} />
            <meshBasicMaterial color={beam.color} transparent opacity={Math.min(beam.life * 3, 0.8)} />
          </mesh>
        );
      })}
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
      color: "#ff3333",
      life: 0,
      maxLife: 0.3,
      active: false,
    }))
  );

  const laserCallback = useCallback((from: THREE.Vector3, to: THREE.Vector3, color: string) => {
    // Find inactive laser
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

  // Capital ship positions — spread wide around battle center
  const imperialShips = useMemo(() => [
    { pos: new THREE.Vector3(BATTLE_CENTER[0] + 35, BATTLE_CENTER[1] + 8, BATTLE_CENTER[2] - 15), rot: new THREE.Euler(0, -0.8, 0.05) },
    { pos: new THREE.Vector3(BATTLE_CENTER[0] + 28, BATTLE_CENTER[1] - 5, BATTLE_CENTER[2] + 20), rot: new THREE.Euler(0, -1.2, -0.03) },
    { pos: new THREE.Vector3(BATTLE_CENTER[0] + 42, BATTLE_CENTER[1] + 3, BATTLE_CENTER[2] + 8), rot: new THREE.Euler(0, -0.5, 0.02) },
  ], []);

  const rebelShips = useMemo(() => [
    { pos: new THREE.Vector3(BATTLE_CENTER[0] - 30, BATTLE_CENTER[1] - 4, BATTLE_CENTER[2] + 12), rot: new THREE.Euler(0, 0.6, -0.04) },
    { pos: new THREE.Vector3(BATTLE_CENTER[0] - 25, BATTLE_CENTER[1] + 6, BATTLE_CENTER[2] - 18), rot: new THREE.Euler(0, 1.0, 0.03) },
  ], []);

  const imperialPositions = useMemo(() => imperialShips.map(s => s.pos), [imperialShips]);
  const rebelPositions = useMemo(() => rebelShips.map(s => s.pos), [rebelShips]);

  return (
    <group>
      {/* Death Star — looming in background */}
      <DeathStar position={[BATTLE_CENTER[0] + 70, BATTLE_CENTER[1] + 20, BATTLE_CENTER[2] - 50]} />

      {/* Imperial Star Destroyers */}
      {imperialShips.map((ship, i) => (
        <CapitalShip key={`imp-${i}`} position={ship.pos} rotation={ship.rot} isImperial={true} index={i} />
      ))}

      {/* Rebel capital ships (Mon Calamari cruisers) */}
      {rebelShips.map((ship, i) => (
        <CapitalShip key={`reb-${i}`} position={ship.pos} rotation={ship.rot} isImperial={false} index={i + 10} />
      ))}

      {/* Fighter swarms */}
      <FighterSwarm laserCallback={laserCallback} />

      {/* Laser bolts */}
      <LaserBolts lasersRef={lasersRef} />

      {/* Capital ship turbolaser exchanges */}
      <TurbolaserExchanges imperialPositions={imperialPositions} rebelPositions={rebelPositions} />

      {/* Explosions */}
      <ExplosionParticles />

      {/* Battle area ambient light — stronger so ships are visible at distance */}
      <pointLight position={BATTLE_CENTER} color="#ff6633" intensity={3} distance={120} />
      <pointLight position={[BATTLE_CENTER[0]+30, BATTLE_CENTER[1], BATTLE_CENTER[2]]} color="#4466ff" intensity={2} distance={80} />
      <pointLight position={[BATTLE_CENTER[0]-30, BATTLE_CENTER[1], BATTLE_CENTER[2]]} color="#ff4422" intensity={1.5} distance={80} />
    </group>
  );
}
