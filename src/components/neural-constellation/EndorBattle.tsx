/**
 * Full Endor Battle — ambient Star Wars-style space battle background
 * Plays behind the agent constellation as a decorative, ever-changing scene.
 * Features: Star Destroyers, Mon Calamari cruisers, Death Star, fighters, lasers, explosions.
 */
import { useRef, useMemo, useCallback, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════
//  GEOMETRY MERGE HELPER
// ═══════════════════════════════════════════════════════════════

function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  for (const g of geometries) totalVerts += g.attributes.position.count;
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
      for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + vertOffset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + vertOffset);
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

// ═══════════════════════════════════════════════════════════════
//  MOVIE-ACCURATE SHIP GEOMETRIES
// ═══════════════════════════════════════════════════════════════

function createStarDestroyerGeometry(): THREE.BufferGeometry {
  // Imperial Star Destroyer — long dagger wedge, 2:1 length-to-width
  // The hull is a flat triangular wedge tapering to a sharp point
  const shape = new THREE.Shape();
  shape.moveTo(0, 5.0);        // sharp nose tip
  shape.lineTo(-2.8, -3.0);    // port stern edge
  shape.lineTo(-2.5, -4.0);    // port engine indent
  shape.lineTo(-1.0, -4.5);    // port engine block
  shape.lineTo(-0.3, -4.0);    // center engine gap
  shape.lineTo(0, -4.2);       // center keel
  shape.lineTo(0.3, -4.0);
  shape.lineTo(1.0, -4.5);     // starboard engine block
  shape.lineTo(2.5, -4.0);
  shape.lineTo(2.8, -3.0);     // starboard stern
  shape.closePath();

  const hull = new THREE.ExtrudeGeometry(shape, {
    depth: 0.6, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.08, bevelSegments: 2
  });
  hull.rotateX(Math.PI / 2);
  hull.scale(1.8, 0.25, 1.8);

  // Command tower — the iconic T-shaped bridge
  const towerBase = new THREE.BoxGeometry(0.8, 1.2, 0.5);
  towerBase.translate(0, 0.75, -3.5);
  const towerNeck = new THREE.BoxGeometry(0.4, 0.6, 0.3);
  towerNeck.translate(0, 1.5, -3.5);
  // Bridge wings (the horizontal T bar)
  const bridgeWing = new THREE.BoxGeometry(2.4, 0.12, 0.7);
  bridgeWing.translate(0, 1.85, -3.5);
  // Shield generator domes (two small spheres on top)
  const dome1 = new THREE.SphereGeometry(0.18, 6, 6);
  dome1.translate(-0.7, 2.1, -3.5);
  const dome2 = new THREE.SphereGeometry(0.18, 6, 6);
  dome2.translate(0.7, 2.1, -3.5);

  // Surface detail — raised panels along the hull
  const panel1 = new THREE.BoxGeometry(3.0, 0.08, 1.5);
  panel1.translate(0, 0.2, 0);
  const panel2 = new THREE.BoxGeometry(1.5, 0.06, 2.0);
  panel2.translate(0, 0.18, -1.5);

  return mergeBufferGeometries([hull, towerBase, towerNeck, bridgeWing, dome1, dome2, panel1, panel2]);
}

function createMonCalGeometry(): THREE.BufferGeometry {
  // MC80 Home One type — organic, bulbous, elongated with distinct bow and stern
  const mainHull = new THREE.SphereGeometry(1.4, 16, 12);
  const pos = mainHull.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Elongate forward, taper at stern
    const zFactor = z > 0 ? 1.0 + z * 0.3 : 1.0 - Math.abs(z) * 0.15;
    pos.setX(i, x * 2.2 * zFactor);
    pos.setY(i, y * 0.7 * (1.0 + Math.abs(z) * 0.1));
    pos.setZ(i, z * 2.0);
  }
  pos.needsUpdate = true;
  mainHull.computeVertexNormals();

  // Bulbous wing pods — the distinctive lateral bulges
  const pod1 = new THREE.SphereGeometry(0.6, 8, 8);
  pod1.scale(1.5, 0.5, 1.0);
  pod1.translate(2.0, -0.2, 0.5);
  const pod2 = new THREE.SphereGeometry(0.6, 8, 8);
  pod2.scale(1.5, 0.5, 1.0);
  pod2.translate(-2.0, -0.2, 0.5);

  // Engine cluster at stern
  const eng1 = new THREE.CylinderGeometry(0.25, 0.35, 0.8, 8);
  eng1.rotateX(Math.PI / 2); eng1.translate(0.5, -0.1, -2.8);
  const eng2 = new THREE.CylinderGeometry(0.25, 0.35, 0.8, 8);
  eng2.rotateX(Math.PI / 2); eng2.translate(-0.5, -0.1, -2.8);
  const eng3 = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 8);
  eng3.rotateX(Math.PI / 2); eng3.translate(0, 0.2, -2.6);

  // Bridge dome on top
  const bridge = new THREE.SphereGeometry(0.4, 8, 6);
  bridge.scale(1.2, 0.6, 1.0);
  bridge.translate(0, 0.85, 0.8);

  return mergeBufferGeometries([mainHull, pod1, pod2, eng1, eng2, eng3, bridge]);
}

function createXWingGeometry(): THREE.BufferGeometry {
  // T-65 X-Wing — long nose, 4 S-foils in attack position, cylindrical fuselage
  const fuselage = new THREE.CylinderGeometry(0.04, 0.05, 0.65, 6);
  fuselage.rotateX(Math.PI / 2);
  // Long pointed nose
  const nose = new THREE.ConeGeometry(0.04, 0.35, 6);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0, 0.5);
  // Cockpit canopy
  const cockpit = new THREE.SphereGeometry(0.05, 6, 4);
  cockpit.scale(0.8, 0.6, 1.0);
  cockpit.translate(0, 0.04, 0.15);
  // 4 S-foils in attack position (X shape)
  const wing = (angle: number) => {
    const w = new THREE.BoxGeometry(0.6, 0.012, 0.22);
    w.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
    return w;
  };
  const w1 = wing(0.35); w1.translate(0.18, 0.08, -0.05);
  const w2 = wing(-0.35); w2.translate(-0.18, 0.08, -0.05);
  const w3 = wing(Math.PI + 0.35); w3.translate(0.18, -0.08, -0.05);
  const w4 = wing(Math.PI - 0.35); w4.translate(-0.18, -0.08, -0.05);
  // Laser cannon tips (4 thin cylinders at wing tips)
  const cannon = (x: number, y: number) => {
    const c = new THREE.CylinderGeometry(0.008, 0.008, 0.3, 3);
    c.rotateX(Math.PI / 2);
    c.translate(x, y, 0.1);
    return c;
  };
  const c1 = cannon(0.42, 0.14);
  const c2 = cannon(-0.42, 0.14);
  const c3 = cannon(0.42, -0.14);
  const c4 = cannon(-0.42, -0.14);
  // Engine nacelles (4 at wing roots)
  const engine = (x: number, y: number) => {
    const e = new THREE.CylinderGeometry(0.022, 0.028, 0.12, 4);
    e.rotateX(Math.PI / 2);
    e.translate(x, y, -0.25);
    return e;
  };
  const e1 = engine(0.15, 0.06);
  const e2 = engine(-0.15, 0.06);
  const e3 = engine(0.15, -0.06);
  const e4 = engine(-0.15, -0.06);

  return mergeBufferGeometries([fuselage, nose, cockpit, w1, w2, w3, w4, c1, c2, c3, c4, e1, e2, e3, e4]);
}

function createTIEGeometry(): THREE.BufferGeometry {
  // TIE/ln Fighter — ball cockpit, two vertical hexagonal solar panels, short pylons
  const cockpit = new THREE.SphereGeometry(0.07, 8, 8);
  // Viewport window (darker front section)
  const viewport = new THREE.CircleGeometry(0.045, 6);
  viewport.translate(0, 0, 0.069);

  // Hexagonal solar array panels (flat, large relative to cockpit)
  const panelShape = new THREE.Shape();
  const hexR = 0.2;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = Math.cos(a) * hexR;
    const py = Math.sin(a) * hexR;
    if (i === 0) panelShape.moveTo(px, py);
    else panelShape.lineTo(px, py);
  }
  panelShape.closePath();

  const panelGeo1 = new THREE.ExtrudeGeometry(panelShape, { depth: 0.008, bevelEnabled: false });
  panelGeo1.rotateY(Math.PI / 2);
  panelGeo1.translate(0.2, 0, 0);
  const panelGeo2 = new THREE.ExtrudeGeometry(panelShape, { depth: 0.008, bevelEnabled: false });
  panelGeo2.rotateY(-Math.PI / 2);
  panelGeo2.translate(-0.2, 0, 0);

  // Connecting pylons (short struts)
  const pylon1 = new THREE.CylinderGeometry(0.012, 0.015, 0.14, 4);
  pylon1.rotateZ(Math.PI / 2);
  pylon1.translate(0.1, 0, 0);
  const pylon2 = new THREE.CylinderGeometry(0.012, 0.015, 0.14, 4);
  pylon2.rotateZ(Math.PI / 2);
  pylon2.translate(-0.1, 0, 0);

  return mergeBufferGeometries([cockpit, viewport, panelGeo1, panelGeo2, pylon1, pylon2]);
}

// Also add A-Wing (Rebel interceptor)
function createAWingGeometry(): THREE.BufferGeometry {
  // RZ-1 A-Wing — wedge-shaped, very fast interceptor
  const body = new THREE.ConeGeometry(0.08, 0.4, 4);
  body.rotateX(-Math.PI / 2);
  body.rotateZ(Math.PI / 4); // diamond cross-section
  // Two large engine pods
  const eng1 = new THREE.CylinderGeometry(0.025, 0.03, 0.2, 4);
  eng1.rotateX(Math.PI / 2);
  eng1.translate(0.06, 0, -0.12);
  const eng2 = new THREE.CylinderGeometry(0.025, 0.03, 0.2, 4);
  eng2.rotateX(Math.PI / 2);
  eng2.translate(-0.06, 0, -0.12);
  return mergeBufferGeometries([body, eng1, eng2]);
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
    const cycle = firingRef.current % 14;
    const isFiring = cycle < 1.0;
    if (laserRef.current) {
      (laserRef.current.material as THREE.MeshBasicMaterial).opacity = isFiring ? 0.6 + Math.sin(firingRef.current * 40) * 0.3 : 0;
      laserRef.current.scale.x = isFiring ? 1 : 0;
    }
    if (glowRef.current) {
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = isFiring ? 0.2 : 0.03;
    }
  });

  return (
    <group ref={ref} position={position} scale={[2.5, 2.5, 2.5]}>
      <mesh>
        <sphereGeometry args={[5, 32, 32]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.85} metalness={0.3} emissive="#0a0a0a" emissiveIntensity={0.4} />
      </mesh>
      {/* Equatorial trench */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.02, 0.18, 6, 48]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.95} />
      </mesh>
      {/* Superlaser dish (concave) */}
      <mesh position={[2, 2.5, 3.2]} rotation={[0.3, 0.8, 0]}>
        <ringGeometry args={[0.3, 1.5, 16]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={glowRef} position={[2, 2.5, 3.5]}>
        <sphereGeometry args={[1.8, 12, 12]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0.03} />
      </mesh>
      <mesh ref={laserRef} position={[2, 2.5, 22]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.12, 40, 6]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0} />
      </mesh>
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
  const driftSpeed = useRef(0.08 + Math.random() * 0.1);
  const driftPhase = useRef(Math.random() * Math.PI * 2);

  const geometry = useMemo(() =>
    isImperial ? createStarDestroyerGeometry() : createMonCalGeometry(),
    [isImperial]
  );

  // Movie-accurate colors
  const color = isImperial ? "#9aa4ad" : "#8b7355";
  const emissiveColor = isImperial ? "#2a3a55" : "#3a2a18";

  useFrame((_, delta) => {
    if (!ref.current) return;
    driftPhase.current += delta * driftSpeed.current;
    ref.current.position.x = position.x + Math.sin(driftPhase.current + index) * 0.8;
    ref.current.position.y = position.y + Math.cos(driftPhase.current * 0.6 + index * 2) * 0.4;
    ref.current.position.z = position.z + Math.sin(driftPhase.current * 0.4) * 0.5;
    ref.current.rotation.z = rotation.z + Math.sin(driftPhase.current * 0.2) * 0.02;
  });

  const shipScale = isImperial ? 3.5 : 2.8;

  return (
    <group ref={ref} position={position} rotation={rotation} scale={[shipScale, shipScale, shipScale]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={0.4}
          roughness={0.55}
          metalness={0.75}
        />
      </mesh>
      {/* Engine glows */}
      {isImperial ? (
        <>
          {[-0.9, -0.35, 0.35, 0.9].map((x, i) => (
            <group key={i}>
              <mesh position={[x * 1.1, 0, -7.5]}>
                <sphereGeometry args={[0.25, 8, 8]} />
                <meshBasicMaterial color="#88aaff" transparent opacity={0.7} />
              </mesh>
              {/* Engine exhaust cone */}
              <mesh position={[x * 1.1, 0, -8.2]}>
                <coneGeometry args={[0.15, 0.8, 6]} />
                <meshBasicMaterial color="#4477ff" transparent opacity={0.3} />
              </mesh>
            </group>
          ))}
        </>
      ) : (
        <>
          {[0.5, -0.5, 0].map((x, i) => (
            <mesh key={i} position={[x, i === 2 ? 0.2 : -0.1, -2.8]}>
              <sphereGeometry args={[0.3, 8, 8]} />
              <meshBasicMaterial color="#ff8844" transparent opacity={0.5} />
            </mesh>
          ))}
        </>
      )}
      <pointLight
        color={isImperial ? "#4466cc" : "#ff6633"}
        intensity={2.5}
        distance={30}
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
      const speed = fighter.faction === "rebel" ? 7 : 6;
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
      fighter.fireCooldown -= clampedDelta;
      if (fighter.fireCooldown <= 0 && dist < 15 && nearest) {
        fighter.fireCooldown = 0.3 + Math.random() * 0.8;
        const laserEnd = fighter.position.clone().addScaledVector(
          new THREE.Vector3().subVectors(nearest.position, fighter.position).normalize(),
          Math.min(dist, 8),
        );
        // Movie colors: Rebels fire RED, Empire fires GREEN
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
      dummy.scale.setScalar(4.0);
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
        <meshStandardMaterial color="#e0ddd8" emissive="#ff6644" emissiveIntensity={0.4} roughness={0.35} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={imperialRef} args={[imperialGeo, undefined, FIGHTER_COUNT / 2]}>
        <meshStandardMaterial color="#556677" emissive="#3355aa" emissiveIntensity={0.5} roughness={0.4} metalness={0.7} />
      </instancedMesh>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
//  LASER BOLTS (pooled — fighters)
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
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - progress * 0.4;
    });
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: MAX_LASERS }, (_, i) => (
        <mesh key={i} ref={(el) => { meshRefs.current[i] = el; }} visible={false}>
          <cylinderGeometry args={[0.05, 0.05, 1.0, 4]} />
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
      ref.current.geometry.attributes.position.needsUpdate = true;
      ref.current.geometry.attributes.color.needsUpdate = true;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={PARTICLE_COUNT} array={particles.current.positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={PARTICLE_COUNT} array={particles.current.colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.4} vertexColors transparent opacity={0.9} sizeAttenuation />
    </points>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TURBOLASER BOLTS (traveling bolts between capital ships)
//  Uses imperative refs to avoid React re-render issues
// ═══════════════════════════════════════════════════════════════

const MAX_TURBO_BOLTS = 30;

interface TurboBolt {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  progress: number; // 0 to 1
  speed: number;
  active: boolean;
}

function TurbolaserExchanges({ imperialPositions, rebelPositions }: {
  imperialPositions: THREE.Vector3[];
  rebelPositions: THREE.Vector3[];
}) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const bolts = useRef<TurboBolt[]>(
    Array.from({ length: MAX_TURBO_BOLTS }, () => ({
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      color: "#33ff66",
      progress: 0,
      speed: 1.5,
      active: false,
    }))
  );
  const spawnTimer = useRef(0);

  useFrame((_, delta) => {
    // Spawn new bolts
    spawnTimer.current += delta;
    if (spawnTimer.current > 0.15 + Math.random() * 0.2) {
      spawnTimer.current = 0;
      if (imperialPositions.length > 0 && rebelPositions.length > 0) {
        const bolt = bolts.current.find(b => !b.active);
        if (bolt) {
          const fromImperial = Math.random() > 0.4; // Empire fires more
          const sources = fromImperial ? imperialPositions : rebelPositions;
          const targets = fromImperial ? rebelPositions : imperialPositions;
          bolt.from.copy(sources[Math.floor(Math.random() * sources.length)]);
          bolt.to.copy(targets[Math.floor(Math.random() * targets.length)]);
          // Offset from ship center slightly
          bolt.from.add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6));
          bolt.to.add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6));
          // Movie colors: Imperial = green, Rebel = red
          bolt.color = fromImperial ? "#33ff66" : "#ff4444";
          bolt.progress = 0;
          bolt.speed = 1.2 + Math.random() * 0.8;
          bolt.active = true;
        }
      }
    }

    // Update all bolts
    bolts.current.forEach((bolt, i) => {
      const mesh = meshRefs.current[i];
      if (!mesh) return;

      if (!bolt.active) {
        mesh.visible = false;
        return;
      }

      bolt.progress += delta * bolt.speed;
      if (bolt.progress >= 1.0) {
        bolt.active = false;
        mesh.visible = false;
        return;
      }

      // Position the bolt along the path
      const currentPos = new THREE.Vector3().lerpVectors(bolt.from, bolt.to, bolt.progress);
      const dir = new THREE.Vector3().subVectors(bolt.to, bolt.from).normalize();

      mesh.position.copy(currentPos);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      mesh.visible = true;

      // Update color
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(bolt.color);
      mat.opacity = 0.9 - bolt.progress * 0.3;
    });
  });

  return (
    <group>
      {Array.from({ length: MAX_TURBO_BOLTS }, (_, i) => (
        <mesh key={i} ref={(el) => { meshRefs.current[i] = el; }} visible={false}>
          <cylinderGeometry args={[0.12, 0.12, 2.5, 4]} />
          <meshBasicMaterial color="#33ff66" transparent opacity={0.9} />
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
      color: "#ff3333",
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

  // Capital ship positions
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

      {/* Rebel Mon Calamari cruisers */}
      {rebelShips.map((ship, i) => (
        <CapitalShip key={`reb-${i}`} position={ship.pos} rotation={ship.rot} isImperial={false} index={i + 10} />
      ))}

      {/* Fighter swarms */}
      <FighterSwarm laserCallback={laserCallback} />

      {/* Fighter laser bolts */}
      <LaserBolts lasersRef={lasersRef} />

      {/* Capital ship turbolaser exchanges — traveling bolts */}
      <TurbolaserExchanges imperialPositions={imperialPositions} rebelPositions={rebelPositions} />

      {/* Explosions */}
      <ExplosionParticles />

      {/* Battle area lighting */}
      <pointLight position={BATTLE_CENTER} color="#ff6633" intensity={3} distance={120} />
      <pointLight position={[BATTLE_CENTER[0] + 30, BATTLE_CENTER[1], BATTLE_CENTER[2]]} color="#4466ff" intensity={2} distance={80} />
      <pointLight position={[BATTLE_CENTER[0] - 30, BATTLE_CENTER[1], BATTLE_CENTER[2]]} color="#ff4422" intensity={1.5} distance={80} />
    </group>
  );
}
