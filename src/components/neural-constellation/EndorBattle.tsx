/**
 * Full Endor Battle — Agent-driven space battle with scoring.
 * Ships have HP, are destroyable, score is tracked, auto-restarts.
 * Agent specialties drive faction bonuses (speed, accuracy, shields, etc.)
 * Laser colors: Rebels fire RED, Empire fires GREEN (movie-accurate).
 */
import { useRef, useMemo, useCallback, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════
//  TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════

const BATTLE_CENTER: [number, number, number] = [0, 15, -45];
const BATTLE_RADIUS = 25;
const FIGHTER_COUNT = 80;
const MAX_LASERS = 120;
const MAX_TURBO_BOLTS = 60;
const RESTART_DELAY = 4; // seconds before auto-restart

interface AgentBonus {
  callSign: string;
  specialty: string;
  faction: "rebel" | "imperial";
  // Computed bonuses from specialty
  speedMult: number;
  accuracyMult: number;
  shieldMult: number;
  fireRateMult: number;
  damageMult: number;
}

interface CapitalShipState {
  position: THREE.Vector3;
  basePosition: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive: boolean;
  faction: "rebel" | "imperial";
  index: number;
  driftPhase: number;
  driftSpeed: number;
  assignedAgent: string | null;
}

interface FighterData {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  faction: "rebel" | "imperial";
  alive: boolean;
  hp: number;
  fireCooldown: number;
  bankAngle: number;
  evadeTimer: number;
}

interface LaserBolt {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  life: number;
  maxLife: number;
  active: boolean;
  damage: number;
  targetFaction: "rebel" | "imperial";
}

interface TurboBolt {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
  life: number;
  maxLife: number;
  active: boolean;
  damage: number;
  targetIndex: number;
  targetFaction: "rebel" | "imperial";
}

interface BattleScore {
  rebel: number;
  imperial: number;
  round: number;
  rebelShipsLeft: number;
  imperialShipsLeft: number;
  rebelFightersLeft: number;
  imperialFightersLeft: number;
  gameOver: boolean;
  winner: "rebel" | "imperial" | null;
  restartTimer: number;
}

// ═══════════════════════════════════════════════════════════════
//  AGENT SPECIALTY → BATTLE BONUS MAPPING
// ═══════════════════════════════════════════════════════════════

function computeAgentBonuses(agents?: { callSign: string; specialty: string }[]): { rebel: AgentBonus[]; imperial: AgentBonus[] } {
  if (!agents || agents.length === 0) {
    return { rebel: [], imperial: [] };
  }

  // Assign agents to factions based on their role
  const imperialCallSigns = ["WRAITH", "NEO", "SPECTER", "VIPER", "WARDEN", "FORGE", "0DAY", "SENTINEL-OPS", "CERBERUS"];
  const bonuses: AgentBonus[] = agents.map(a => {
    const faction = imperialCallSigns.includes(a.callSign) ? "imperial" : "rebel";
    const spec = (a.specialty || "").toLowerCase();

    let speedMult = 1, accuracyMult = 1, shieldMult = 1, fireRateMult = 1, damageMult = 1;

    // Map specialties to combat bonuses
    if (spec.includes("cyber") || spec.includes("apt") || spec.includes("offensive")) {
      damageMult = 1.3; fireRateMult = 1.2; // Offensive → more damage
    }
    if (spec.includes("financial") || spec.includes("aml") || spec.includes("fraud")) {
      shieldMult = 1.3; // Resource management → better shields
    }
    if (spec.includes("security") || spec.includes("physical") || spec.includes("protection")) {
      shieldMult = 1.25; accuracyMult = 1.15; // Defense → shields + accuracy
    }
    if (spec.includes("intel") || spec.includes("investigation") || spec.includes("osint")) {
      accuracyMult = 1.3; // Intel → precision targeting
    }
    if (spec.includes("counter") || spec.includes("espionage")) {
      speedMult = 1.2; accuracyMult = 1.15; // Counterintel → evasion + accuracy
    }
    if (spec.includes("supply") || spec.includes("chain")) {
      fireRateMult = 1.25; shieldMult = 1.1; // Logistics → faster resupply
    }
    if (spec.includes("narco") || spec.includes("drug")) {
      speedMult = 1.25; damageMult = 1.15; // Aggressive → speed + damage
    }
    if (spec.includes("geoint") || spec.includes("geo") || spec.includes("terrain")) {
      accuracyMult = 1.25; speedMult = 1.1; // Spatial awareness
    }
    if (spec.includes("terror") || spec.includes("sentinel")) {
      damageMult = 1.2; fireRateMult = 1.15;
    }
    if (spec.includes("simulat") || spec.includes("war") || spec.includes("game")) {
      speedMult = 1.15; accuracyMult = 1.15; damageMult = 1.1; fireRateMult = 1.1; // Wargamer → balanced
    }
    if (spec.includes("command") || spec.includes("orchestrat")) {
      speedMult = 1.1; accuracyMult = 1.1; shieldMult = 1.1; fireRateMult = 1.1; damageMult = 1.1; // Commander → all +10%
    }
    if (spec.includes("content") || spec.includes("moderat")) {
      shieldMult = 1.2; // Defensive posture
    }
    if (spec.includes("data") || spec.includes("quality")) {
      accuracyMult = 1.35; // Precision
    }

    return { callSign: a.callSign, specialty: a.specialty, faction, speedMult, accuracyMult, shieldMult, fireRateMult, damageMult };
  });

  return {
    rebel: bonuses.filter(b => b.faction === "rebel"),
    imperial: bonuses.filter(b => b.faction === "imperial"),
  };
}

function getFactionMultipliers(bonuses: AgentBonus[]) {
  if (bonuses.length === 0) return { speed: 1, accuracy: 1, shield: 1, fireRate: 1, damage: 1 };
  // Average all agent bonuses for the faction
  const avg = (key: keyof AgentBonus) => bonuses.reduce((s, b) => s + (b[key] as number), 0) / bonuses.length;
  return {
    speed: avg("speedMult"),
    accuracy: avg("accuracyMult"),
    shield: avg("shieldMult"),
    fireRate: avg("fireRateMult"),
    damage: avg("damageMult"),
  };
}

// ═══════════════════════════════════════════════════════════════
//  SHIP GEOMETRY BUILDERS
// ═══════════════════════════════════════════════════════════════

function createStarDestroyerGeometry(): THREE.BufferGeometry {
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, 3.0);
  hullShape.lineTo(-1.6, -2.0);
  hullShape.lineTo(-1.4, -2.3); hullShape.lineTo(-1.0, -2.1);
  hullShape.lineTo(-0.8, -2.4); hullShape.lineTo(-0.4, -2.2);
  hullShape.lineTo(0, -2.5);
  hullShape.lineTo(0.4, -2.2); hullShape.lineTo(0.8, -2.4);
  hullShape.lineTo(1.0, -2.1); hullShape.lineTo(1.4, -2.3);
  hullShape.lineTo(1.6, -2.0);
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.35, bevelEnabled: false });
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.scale(1.5, 0.25, 1.5);

  const towerBase = new THREE.BoxGeometry(0.3, 0.8, 0.25);
  towerBase.translate(0, 0.55, -1.8);
  const towerBar = new THREE.BoxGeometry(1.2, 0.2, 0.2);
  towerBar.translate(0, 0.95, -1.8);
  const domL = new THREE.SphereGeometry(0.12, 6, 6);
  domL.translate(-0.4, 1.1, -1.8);
  const domR = new THREE.SphereGeometry(0.12, 6, 6);
  domR.translate(0.4, 1.1, -1.8);
  const panel1 = new THREE.BoxGeometry(0.05, 0.02, 3.5);
  panel1.translate(-0.5, 0.13, -0.2);
  const panel2 = new THREE.BoxGeometry(0.05, 0.02, 3.5);
  panel2.translate(0.5, 0.13, -0.2);

  const positions: number[] = [];
  const normals: number[] = [];
  for (const g of [hullGeo, towerBase, towerBar, domL, domR, panel1, panel2]) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { positions.push(p[i]); normals.push(n[i]); }
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeBoundingSphere();
  return merged;
}

function createMonCalGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  function addGeo(g: THREE.BufferGeometry) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { positions.push(p[i]); normals.push(n[i]); }
  }
  const hull = new THREE.SphereGeometry(1, 10, 8);
  hull.scale(2.5, 0.55, 0.9); addGeo(hull);
  const podL = new THREE.SphereGeometry(0.5, 6, 6);
  podL.scale(1.0, 0.8, 1.2); podL.translate(0.3, 0, -0.9); addGeo(podL);
  const podR = new THREE.SphereGeometry(0.5, 6, 6);
  podR.scale(1.0, 0.8, 1.2); podR.translate(0.3, 0, 0.9); addGeo(podR);
  const bridge = new THREE.SphereGeometry(0.3, 6, 6);
  bridge.scale(1.0, 0.6, 0.8); bridge.translate(1.0, 0.5, 0); addGeo(bridge);
  for (let i = 0; i < 5; i++) {
    const eng = new THREE.SphereGeometry(0.18, 5, 5);
    const angle = (i / 5) * Math.PI * 2;
    eng.translate(-2.4, Math.sin(angle) * 0.3, Math.cos(angle) * 0.3); addGeo(eng);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeBoundingSphere();
  return merged;
}

function createFighterGeometry(isXWing: boolean): THREE.BufferGeometry {
  return isXWing ? new THREE.BoxGeometry(0.1, 0.02, 0.15) : new THREE.BoxGeometry(0.12, 0.12, 0.04);
}

function createMillenniumFalconGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  function addGeo(g: THREE.BufferGeometry) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { positions.push(p[i]); normals.push(n[i]); }
  }

  // === MAIN SAUCER — slightly oval, flat disc ===
  const disc = new THREE.CylinderGeometry(1.0, 1.0, 0.06, 24);
  disc.rotateX(Math.PI / 2);
  disc.scale(1.0, 1.0, 0.88); // wider than long
  addGeo(disc);

  // Raised center hull plate (the thicker raised area on top/bottom)
  const centerHull = new THREE.CylinderGeometry(0.55, 0.6, 0.1, 16);
  centerHull.rotateX(Math.PI / 2);
  centerHull.translate(0, 0.06, -0.08);
  addGeo(centerHull);

  // === FORWARD MANDIBLES — the iconic wedge fork ===
  // Left mandible — tapered wedge
  const mandL = new THREE.BoxGeometry(0.22, 0.06, 1.0);
  mandL.translate(-0.38, 0, 1.05);
  addGeo(mandL);
  // Right mandible
  const mandR = new THREE.BoxGeometry(0.22, 0.06, 1.0);
  mandR.translate(0.38, 0, 1.05);
  addGeo(mandR);
  // Mandible tips converge slightly — angled nose plates
  const noseL = new THREE.BoxGeometry(0.16, 0.05, 0.3);
  noseL.translate(-0.28, 0, 1.6);
  addGeo(noseL);
  const noseR = new THREE.BoxGeometry(0.16, 0.05, 0.3);
  noseR.translate(0.28, 0, 1.6);
  addGeo(noseR);
  // Crossbar connecting mandible tips
  const crossbar = new THREE.BoxGeometry(0.7, 0.04, 0.06);
  crossbar.translate(0, 0, 1.72);
  addGeo(crossbar);

  // === COCKPIT — starboard side tube + dome (the most recognizable feature) ===
  const cockpitTube = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6);
  cockpitTube.rotateZ(Math.PI / 2);
  cockpitTube.translate(0.85, 0.02, 0.65);
  addGeo(cockpitTube);
  const cockpitDome = new THREE.SphereGeometry(0.13, 8, 6);
  cockpitDome.scale(1.0, 0.7, 1.0);
  cockpitDome.translate(1.18, 0.04, 0.65);
  addGeo(cockpitDome);

  // === REAR ENGINE BLOCK — wide exhaust bank ===
  const engineBlock = new THREE.BoxGeometry(1.4, 0.08, 0.1);
  engineBlock.translate(0, 0, -0.88);
  addGeo(engineBlock);
  // Individual engine vents (11 vents for detail)
  for (let i = 0; i < 11; i++) {
    const vent = new THREE.BoxGeometry(0.08, 0.05, 0.04);
    vent.translate(-0.6 + i * 0.12, 0, -0.96);
    addGeo(vent);
  }

  // === SATELLITE DISH — top center-left ===
  const dishStalk = new THREE.CylinderGeometry(0.03, 0.03, 0.08, 4);
  dishStalk.translate(-0.25, 0.1, 0.1);
  addGeo(dishStalk);
  const dish = new THREE.CylinderGeometry(0.0, 0.2, 0.05, 10);
  dish.rotateX(Math.PI);
  dish.translate(-0.25, 0.16, 0.1);
  addGeo(dish);

  // === TOP/BOTTOM TURRET WELLS ===
  const turretTop = new THREE.CylinderGeometry(0.1, 0.12, 0.08, 6);
  turretTop.translate(0.12, 0.1, -0.15);
  addGeo(turretTop);
  const turretBot = new THREE.CylinderGeometry(0.1, 0.12, 0.08, 6);
  turretBot.translate(0.12, -0.1, -0.15);
  addGeo(turretBot);

  // === SURFACE DETAIL — panel lines along the hull ===
  const panelL = new THREE.BoxGeometry(0.02, 0.02, 1.4);
  panelL.translate(-0.65, 0.04, 0.1);
  addGeo(panelL);
  const panelR = new THREE.BoxGeometry(0.02, 0.02, 1.4);
  panelR.translate(0.65, 0.04, 0.1);
  addGeo(panelR);

  // Dorsal hull ridge
  const ridge = new THREE.BoxGeometry(0.8, 0.03, 0.04);
  ridge.translate(0, 0.08, 0.3);
  addGeo(ridge);

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.computeBoundingSphere();
  return merged;
}

// ═══════════════════════════════════════════════════════════════
//  MILLENNIUM FALCON — Hero rebel ship
// ═══════════════════════════════════════════════════════════════

function MillenniumFalcon({ laserCallback, imperialFighters, capitalShips, explosionQueue, onFighterKill }: {
  laserCallback: (from: THREE.Vector3, to: THREE.Vector3, color: string, damage: number, targetFaction: "rebel" | "imperial") => void;
  imperialFighters: React.MutableRefObject<FighterData[]>;
  capitalShips: React.MutableRefObject<CapitalShipState[]>;
  explosionQueue: React.MutableRefObject<THREE.Vector3[]>;
  onFighterKill: (faction: "rebel" | "imperial") => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const geo = useMemo(() => createMillenniumFalconGeometry(), []);
  const posRef = useRef(new THREE.Vector3(BATTLE_CENTER[0] - 10, BATTLE_CENTER[1] + 3, BATTLE_CENTER[2]));
  const velRef = useRef(new THREE.Vector3(2, 0, 1));
  const fireTimer = useRef(0);
  const targetRef = useRef(new THREE.Vector3());
  const evadeTimer = useRef(0);
  const rollAngle = useRef(0);
  const alive = useRef(true);
  const hp = useRef(15); // Tough little ship

  useFrame((_, delta) => {
    if (!ref.current || !alive.current) {
      if (ref.current) ref.current.visible = false;
      return;
    }
    ref.current.visible = true;
    const dt = Math.min(delta, 0.05);

    // Find nearest imperial target
    const impFighters = imperialFighters.current.filter(f => f.faction === "imperial" && f.alive);
    const impShips = capitalShips.current.filter(s => s.faction === "imperial" && s.alive);

    let nearestPos: THREE.Vector3 | null = null;
    let nearestDist = Infinity;

    for (const f of impFighters) {
      const d = posRef.current.distanceTo(f.position);
      if (d < nearestDist) { nearestDist = d; nearestPos = f.position; }
    }
    if (Math.random() < 0.02 || !nearestPos) {
      for (const s of impShips) {
        const d = posRef.current.distanceTo(s.position);
        if (d < nearestDist * 1.5) { nearestDist = d; nearestPos = s.position; }
      }
    }

    if (nearestPos) targetRef.current.copy(nearestPos);

    // Pursuit with evasive jinking
    const toTarget = new THREE.Vector3().subVectors(targetRef.current, posRef.current).normalize();
    evadeTimer.current -= dt;
    if (evadeTimer.current <= 0) {
      evadeTimer.current = 0.5 + Math.random() * 1.5;
      toTarget.x += (Math.random() - 0.5) * 1.2;
      toTarget.y += (Math.random() - 0.5) * 0.8;
      toTarget.z += (Math.random() - 0.5) * 1.2;
      toTarget.normalize();
    }

    // === COLLISION AVOIDANCE ===
    // Steer away from capital ships
    const avoidForce = new THREE.Vector3();
    const AVOID_DIST_CAP = 6;
    const AVOID_DIST_FIGHTER = 2;
    for (const s of capitalShips.current) {
      if (!s.alive) continue;
      const diff = new THREE.Vector3().subVectors(posRef.current, s.position);
      const d = diff.length();
      if (d < AVOID_DIST_CAP && d > 0.1) {
        diff.normalize().multiplyScalar((AVOID_DIST_CAP - d) / AVOID_DIST_CAP * 15);
        avoidForce.add(diff);
      }
    }
    // Steer away from nearby fighters
    for (const f of imperialFighters.current) {
      if (!f.alive) continue;
      const diff = new THREE.Vector3().subVectors(posRef.current, f.position);
      const d = diff.length();
      if (d < AVOID_DIST_FIGHTER && d > 0.1) {
        diff.normalize().multiplyScalar((AVOID_DIST_FIGHTER - d) / AVOID_DIST_FIGHTER * 8);
        avoidForce.add(diff);
      }
    }

    const speed = 10;
    const steer = toTarget.multiplyScalar(speed).add(avoidForce);
    velRef.current.lerp(steer.normalize().multiplyScalar(speed), dt * 3);
    posRef.current.addScaledVector(velRef.current, dt);

    // Keep in bounds
    const fromCenter = new THREE.Vector3(
      posRef.current.x - BATTLE_CENTER[0],
      posRef.current.y - BATTLE_CENTER[1],
      posRef.current.z - BATTLE_CENTER[2],
    );
    if (fromCenter.length() > BATTLE_RADIUS * 1.3) {
      fromCenter.normalize().multiplyScalar(-3);
      velRef.current.add(fromCenter);
    }

    ref.current.position.copy(posRef.current);
    if (velRef.current.lengthSq() > 0.01) {
      ref.current.lookAt(posRef.current.clone().add(velRef.current));
    }
    const cross = new THREE.Vector3().crossVectors(velRef.current.clone().normalize(), toTarget.normalize());
    rollAngle.current = THREE.MathUtils.lerp(rollAngle.current, cross.y * 2, dt * 4);
    ref.current.rotateZ(rollAngle.current);

    // Quad laser fire
    fireTimer.current -= dt;
    if (fireTimer.current <= 0 && nearestDist < 18) {
      fireTimer.current = 0.12 + Math.random() * 0.1;
      const dir = new THREE.Vector3().subVectors(targetRef.current, posRef.current).normalize();
      const end = posRef.current.clone().addScaledVector(dir, Math.min(nearestDist, 10));
      laserCallback(posRef.current.clone(), end, "#ff2222", 2, "imperial");
      const offset = new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, 0);
      laserCallback(posRef.current.clone().add(offset), end.clone().add(offset), "#ff2222", 2, "imperial");
    }
  });

  return (
    <group ref={ref} position={posRef.current}>
      {/* Main hull — weathered grey-green like the movie */}
      <mesh geometry={geo} scale={1.2}>
        <meshStandardMaterial color="#b8b8a0" emissive="#666655" emissiveIntensity={0.3} roughness={0.6} metalness={0.5} />
      </mesh>
      {/* Engine glow bank (rear, bright blue) */}
      <mesh position={[0, 0, -1.1]} scale={[1.4, 0.3, 0.3]}>
        <sphereGeometry args={[0.25, 6, 4]} />
        <meshBasicMaterial color="#5599ff" transparent opacity={0.8} />
      </mesh>
      {/* Cockpit glow */}
      <mesh position={[1.42, 0.05, 0.78]}>
        <sphereGeometry args={[0.08, 4, 4]} />
        <meshBasicMaterial color="#aaddff" transparent opacity={0.6} />
      </mesh>
      <pointLight color="#5599ff" intensity={2.5} distance={7} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  DEATH STAR (background, not destroyable)
// ═══════════════════════════════════════════════════════════════

// Position for the Endor forest moon
const ENDOR_MOON_POS: [number, number, number] = [BATTLE_CENTER[0] - 40, BATTLE_CENTER[1] - 10, BATTLE_CENTER[2] - 20];

function EndorMoon() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.01;
  });
  return (
    <group position={ENDOR_MOON_POS}>
      <mesh ref={ref}>
        <sphereGeometry args={[6, 24, 24]} />
        <meshStandardMaterial color="#2d4a1e" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Atmosphere glow */}
      <mesh>
        <sphereGeometry args={[6.3, 16, 16]} />
        <meshBasicMaterial color="#88cc66" transparent opacity={0.06} />
      </mesh>
      {/* Cloud layer */}
      <mesh rotation={[0.2, 0, 0.1]}>
        <sphereGeometry args={[6.15, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.04} />
      </mesh>
      <pointLight color="#446633" intensity={0.5} distance={15} />
    </group>
  );
}

function DeathStar({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const laserRef = useRef<THREE.Mesh>(null);
  const firingRef = useRef(0);

  // Compute laser direction toward Endor moon
  const dsPos = useMemo(() => new THREE.Vector3(...position), [position]);
  const moonPos = useMemo(() => new THREE.Vector3(...ENDOR_MOON_POS), []);
  const laserDir = useMemo(() => new THREE.Vector3().subVectors(moonPos, dsPos), [dsPos, moonPos]);
  const laserLen = useMemo(() => laserDir.length(), [laserDir]);
  const laserMidpoint = useMemo(() => new THREE.Vector3().addVectors(dsPos, moonPos).multiplyScalar(0.5), [dsPos, moonPos]);
  const laserQuat = useMemo(() => {
    const dir = laserDir.clone().normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return q;
  }, [laserDir]);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.02;
    firingRef.current += delta;
    const cycle = firingRef.current % 15; // Fire every 15 seconds
    const isFiring = cycle < 1.5; // Fire for 1.5 seconds
    if (laserRef.current) {
      (laserRef.current.material as THREE.MeshBasicMaterial).opacity = isFiring ? 0.5 + Math.sin(firingRef.current * 25) * 0.3 : 0;
      laserRef.current.visible = isFiring;
    }
    if (glowRef.current) {
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = isFiring ? 0.25 : 0.04;
    }
  });

  return (
    <group ref={ref} position={position}>
      <mesh><sphereGeometry args={[5, 24, 24]} /><meshStandardMaterial color="#3a3a3a" roughness={0.8} metalness={0.4} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[5.02, 0.15, 4, 32]} /><meshStandardMaterial color="#222222" roughness={0.9} /></mesh>
      <mesh position={[2, 2.5, 3.2]} rotation={[0.3, 0.8, 0]}><circleGeometry args={[1.5, 16]} /><meshStandardMaterial color="#1a1a1a" roughness={0.95} /></mesh>
      <mesh ref={glowRef} position={[2, 2.5, 3.5]}><sphereGeometry args={[1.8, 12, 12]} /><meshBasicMaterial color="#44ff44" transparent opacity={0.04} /></mesh>
      {/* Superlaser beam aimed at Endor moon */}
      <mesh
        ref={laserRef}
        position={[laserMidpoint.x - position[0], laserMidpoint.y - position[1], laserMidpoint.z - position[2]]}
        quaternion={laserQuat}
        visible={false}
      >
        <cylinderGeometry args={[0.6, 0.15, laserLen, 8]} />
        <meshBasicMaterial color="#44ff44" transparent opacity={0} />
      </mesh>
      <pointLight color="#666666" intensity={1} distance={30} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CAPITAL SHIPS (with HP and damage flash)
// ═══════════════════════════════════════════════════════════════

function CapitalShipMesh({ ship, geometry }: { ship: CapitalShipState; geometry: THREE.BufferGeometry }) {
  const ref = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const damageFlash = useRef(0);
  const lastHp = useRef(ship.hp);

  const isImperial = ship.faction === "imperial";
  const baseColor = isImperial ? "#8899aa" : "#aa7755";
  const emissiveColor = isImperial ? "#334466" : "#553322";

  useFrame((_, delta) => {
    if (!ref.current || !ship.alive) {
      if (ref.current) ref.current.visible = false;
      return;
    }
    ref.current.visible = true;

    // Detect damage
    if (ship.hp < lastHp.current) {
      damageFlash.current = 0.3;
    }
    lastHp.current = ship.hp;

    damageFlash.current = Math.max(0, damageFlash.current - delta);

    // Drift movement
    ship.driftPhase += delta * ship.driftSpeed;
    ref.current.position.x = ship.position.x;
    ref.current.position.y = ship.position.y;
    ref.current.position.z = ship.position.z;
    ref.current.rotation.copy(ship.rotation);

    // Damage flash — red tint
    if (matRef.current) {
      if (damageFlash.current > 0) {
        matRef.current.emissive.set("#ff2222");
        matRef.current.emissiveIntensity = damageFlash.current * 3;
      } else {
        matRef.current.emissive.set(emissiveColor);
        matRef.current.emissiveIntensity = 0.3;
      }
    }
  });

  // HP bar
  const hpFrac = ship.hp / ship.maxHp;

  return (
    <group ref={ref} position={ship.position} rotation={ship.rotation}>
      <mesh geometry={geometry}>
        <meshStandardMaterial ref={matRef} color={baseColor} emissive={emissiveColor} emissiveIntensity={0.3} roughness={0.6} metalness={0.7} />
      </mesh>
      {/* Engine glows */}
      {isImperial ? (
        <>
          {[-0.4, 0, 0.4].map((zOff, ei) => (
            <mesh key={ei} position={[0, 0, -1.5 * 1.5 + zOff * 0.5]}>
              <sphereGeometry args={[0.25, 6, 6]} />
              <meshBasicMaterial color="#6688ff" transparent opacity={0.5} />
            </mesh>
          ))}
        </>
      ) : (
        <>
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
      {/* HP Bar floating above ship */}
      <group position={[0, 2.0, 0]}>
        {/* Background */}
        <mesh>
          <planeGeometry args={[3, 0.2]} />
          <meshBasicMaterial color="#111111" transparent opacity={0.6} />
        </mesh>
        {/* HP fill */}
        <mesh position={[(hpFrac - 1) * 1.5, 0, 0.01]}>
          <planeGeometry args={[3 * hpFrac, 0.18]} />
          <meshBasicMaterial color={hpFrac > 0.5 ? "#22ff44" : hpFrac > 0.25 ? "#ffaa22" : "#ff2222"} transparent opacity={0.8} />
        </mesh>
      </group>
      <pointLight color={isImperial ? "#4466cc" : "#ff6633"} intensity={0.5} distance={8} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  FIGHTER SWARM (with HP and destruction)
// ═══════════════════════════════════════════════════════════════

function FighterSwarm({ 
  laserCallback, fighters, rebelMults, imperialMults 
}: { 
  laserCallback: (from: THREE.Vector3, to: THREE.Vector3, color: string, damage: number, targetFaction: "rebel" | "imperial") => void;
  fighters: React.MutableRefObject<FighterData[]>;
  rebelMults: ReturnType<typeof getFactionMultipliers>;
  imperialMults: ReturnType<typeof getFactionMultipliers>;
}) {
  const rebelRef = useRef<THREE.InstancedMesh>(null);
  const imperialRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.05);
    const rebels = fighters.current.filter(f => f.faction === "rebel" && f.alive);
    const imperials = fighters.current.filter(f => f.faction === "imperial" && f.alive);

    fighters.current.forEach((fighter) => {
      if (!fighter.alive) return;
      const mults = fighter.faction === "rebel" ? rebelMults : imperialMults;
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
      const baseSpeed = fighter.faction === "rebel" ? 6 : 5.5;
      const speed = baseSpeed * mults.speed;
      fighter.velocity.lerp(toTarget.multiplyScalar(speed), clampedDelta * 2);
      fighter.position.addScaledVector(fighter.velocity, clampedDelta);

      // Keep in bounds
      const fromCenter = new THREE.Vector3(
        fighter.position.x - BATTLE_CENTER[0],
        fighter.position.y - BATTLE_CENTER[1],
        fighter.position.z - BATTLE_CENTER[2],
      );
      if (fromCenter.length() > BATTLE_RADIUS * 1.5) {
        fromCenter.normalize().multiplyScalar(-2);
        fighter.velocity.add(fromCenter);
      }

      // Fire lasers with agent bonuses
      fighter.fireCooldown -= clampedDelta;
      const fireInterval = (0.3 + Math.random() * 0.8) / mults.fireRate;
      if (fighter.fireCooldown <= 0 && dist < 15 * mults.accuracy && nearest) {
        fighter.fireCooldown = fireInterval;
        const laserEnd = fighter.position.clone().addScaledVector(
          new THREE.Vector3().subVectors(nearest.position, fighter.position).normalize(),
          Math.min(dist, 8),
        );
        const targetFaction: "rebel" | "imperial" = fighter.faction === "rebel" ? "imperial" : "rebel";
        laserCallback(
          fighter.position.clone(), laserEnd,
          fighter.faction === "rebel" ? "#ff2222" : "#22ff44",
          1 * mults.damage,
          targetFaction,
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
      if (fighter.velocity.lengthSq() > 0.01) dummy.lookAt(fighter.position.clone().add(fighter.velocity));
      dummy.rotateZ(fighter.bankAngle);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      if (fighter.faction === "rebel" && rebelRef.current) rebelRef.current.setMatrixAt(rebelIdx++, dummy.matrix);
      else if (fighter.faction === "imperial" && imperialRef.current) imperialRef.current.setMatrixAt(imperialIdx++, dummy.matrix);
    });

    if (rebelRef.current) { rebelRef.current.count = rebelIdx; rebelRef.current.instanceMatrix.needsUpdate = true; }
    if (imperialRef.current) { imperialRef.current.count = imperialIdx; imperialRef.current.instanceMatrix.needsUpdate = true; }
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
//  LASER BOLTS (pooled, now with damage + hit detection)
// ═══════════════════════════════════════════════════════════════

function LaserBolts({ lasersRef, fighters, onFighterKill }: { 
  lasersRef: React.MutableRefObject<LaserBolt[]>;
  fighters: React.MutableRefObject<FighterData[]>;
  onFighterKill: (faction: "rebel" | "imperial") => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const laserGeo = useMemo(() => new THREE.CylinderGeometry(0.02, 0.02, 0.6, 3), []);
  const meshPool = useRef<THREE.Mesh[]>([]);
  const mounted = useRef(false);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Lazily create and attach meshes once
    if (!mounted.current) {
      // Clear any stale children
      while (groupRef.current.children.length > 0) {
        groupRef.current.remove(groupRef.current.children[0]);
      }
      meshPool.current = Array.from({ length: MAX_LASERS }, () => {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(laserGeo, mat);
        mesh.visible = false;
        groupRef.current!.add(mesh);
        return mesh;
      });
      mounted.current = true;
    }

    lasersRef.current.forEach((laser, i) => {
      const mesh = meshPool.current[i];
      if (!mesh) return;
      if (!laser.active) { mesh.visible = false; return; }
      laser.life += delta;
      if (laser.life >= laser.maxLife) { laser.active = false; mesh.visible = false; return; }
      const progress = laser.life / laser.maxLife;
      const currentPos = new THREE.Vector3().lerpVectors(laser.from, laser.to, progress);
      const dir = new THREE.Vector3().subVectors(laser.to, laser.from).normalize();
      mesh.position.copy(currentPos);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      mesh.visible = true;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(laser.color);
      mat.opacity = 1 - progress * 0.5;

      // Hit detection on fighters
      if (progress > 0.7) {
        for (const f of fighters.current) {
          if (!f.alive || f.faction !== laser.targetFaction) continue;
          if (f.position.distanceTo(currentPos) < 1.5) {
            f.hp -= laser.damage;
            if (f.hp <= 0) { f.alive = false; onFighterKill(f.faction); }
            laser.active = false; mesh.visible = false;
            break;
          }
        }
      }
    });
  });

  return <group ref={groupRef} />;
}

// ═══════════════════════════════════════════════════════════════
//  EXPLOSIONS
// ═══════════════════════════════════════════════════════════════

function ExplosionParticles({ explosionQueue }: { explosionQueue: React.MutableRefObject<THREE.Vector3[]> }) {
  const ref = useRef<THREE.Points>(null);
  const PARTICLE_COUNT = 300;
  const particles = useRef<{ positions: Float32Array; velocities: Float32Array; lifetimes: Float32Array; colors: Float32Array }>({
    positions: new Float32Array(PARTICLE_COUNT * 3),
    velocities: new Float32Array(PARTICLE_COUNT * 3),
    lifetimes: new Float32Array(PARTICLE_COUNT),
    colors: new Float32Array(PARTICLE_COUNT * 3),
  });

  const spawnExplosion = useCallback((pos: THREE.Vector3, size: number = 15) => {
    const p = particles.current;
    let spawned = 0;
    for (let i = 0; i < PARTICLE_COUNT && spawned < size; i++) {
      if (p.lifetimes[i] <= 0) {
        p.positions[i * 3] = pos.x; p.positions[i * 3 + 1] = pos.y; p.positions[i * 3 + 2] = pos.z;
        const s = size > 20 ? 12 : 8;
        p.velocities[i * 3] = (Math.random() - 0.5) * s;
        p.velocities[i * 3 + 1] = (Math.random() - 0.5) * s;
        p.velocities[i * 3 + 2] = (Math.random() - 0.5) * s;
        p.lifetimes[i] = 0.5 + Math.random() * (size > 20 ? 1.5 : 0.8);
        const heat = Math.random();
        p.colors[i * 3] = 1; p.colors[i * 3 + 1] = 0.3 + heat * 0.6; p.colors[i * 3 + 2] = heat * 0.3;
        spawned++;
      }
    }
  }, []);

  useFrame((_, delta) => {
    // Process queued explosions
    while (explosionQueue.current.length > 0) {
      const pos = explosionQueue.current.shift()!;
      spawnExplosion(pos, 30);
    }

    const p = particles.current;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (p.lifetimes[i] <= 0) continue;
      p.lifetimes[i] -= delta;
      p.positions[i * 3] += p.velocities[i * 3] * delta;
      p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * delta;
      p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * delta;
      p.velocities[i * 3] *= 0.97; p.velocities[i * 3 + 1] *= 0.97; p.velocities[i * 3 + 2] *= 0.97;
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
      <pointsMaterial size={0.3} vertexColors transparent opacity={0.9} sizeAttenuation />
    </points>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TURBOLASER BOLTS — POOLED WITH DAMAGE
// ═══════════════════════════════════════════════════════════════

function TurbolaserExchanges({ capitalShips, rebelMults, imperialMults, onShipKill, explosionQueue }: {
  capitalShips: React.MutableRefObject<CapitalShipState[]>;
  rebelMults: ReturnType<typeof getFactionMultipliers>;
  imperialMults: ReturnType<typeof getFactionMultipliers>;
  onShipKill: (faction: "rebel" | "imperial") => void;
  explosionQueue: React.MutableRefObject<THREE.Vector3[]>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const turboGeo = useMemo(() => new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), []);
  const bolts = useRef<TurboBolt[]>(
    Array.from({ length: MAX_TURBO_BOLTS }, () => ({
      position: new THREE.Vector3(), velocity: new THREE.Vector3(),
      color: "#22ff44", life: 0, maxLife: 1.5, active: false, damage: 10, targetIndex: 0, targetFaction: "rebel" as const,
    }))
  );

  const meshPool = useRef<THREE.Mesh[]>([]);
  const mounted = useRef(false);

  const fireTimer = useRef(0);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // Lazily create and attach meshes once
    if (!mounted.current) {
      while (groupRef.current.children.length > 0) {
        groupRef.current.remove(groupRef.current.children[0]);
      }
      meshPool.current = Array.from({ length: MAX_TURBO_BOLTS }, () => {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(turboGeo, mat);
        mesh.visible = false;
        groupRef.current!.add(mesh);
        return mesh;
      });
      mounted.current = true;
    }
    const clampedDelta = Math.min(delta, 0.05);
    const ships = capitalShips.current;
    const aliveImps = ships.filter(s => s.faction === "imperial" && s.alive);
    const aliveRebs = ships.filter(s => s.faction === "rebel" && s.alive);

    fireTimer.current += clampedDelta;
    const fireRate = 0.12 + Math.random() * 0.15;
    if (fireTimer.current > fireRate && aliveImps.length > 0 && aliveRebs.length > 0) {
      fireTimer.current = 0;
      const count = Math.random() > 0.6 ? 2 : 1;
      for (let b = 0; b < count; b++) {
        const bolt = bolts.current.find(bl => !bl.active);
        if (!bolt) break;
        const imperialFires = Math.random() > 0.45;
        const sources = imperialFires ? aliveImps : aliveRebs;
        const targets = imperialFires ? aliveRebs : aliveImps;
        const mults = imperialFires ? imperialMults : rebelMults;

        const sourceShip = sources[Math.floor(Math.random() * sources.length)];
        const targetShip = targets[Math.floor(Math.random() * targets.length)];

        const from = sourceShip.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3));
        const to = targetShip.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 / mults.accuracy, (Math.random() - 0.5) * 1.5 / mults.accuracy, (Math.random() - 0.5) * 2 / mults.accuracy));

        const dir = new THREE.Vector3().subVectors(to, from);
        const dist = dir.length();
        dir.normalize();
        const speed = 30 + Math.random() * 15;
        bolt.position.copy(from);
        bolt.velocity.copy(dir).multiplyScalar(speed);
        bolt.maxLife = dist / speed + 0.1;
        bolt.life = 0;
        bolt.active = true;
        bolt.color = imperialFires ? "#22ff44" : "#ff2222";
        bolt.damage = 8 * mults.damage;
        bolt.targetIndex = targetShip.index;
        bolt.targetFaction = imperialFires ? "rebel" : "imperial";
      }
    }

    bolts.current.forEach((bolt, i) => {
      const mesh = meshPool.current[i];
      if (!mesh) return;
      if (!bolt.active) { mesh.visible = false; return; }
      bolt.life += clampedDelta;
      if (bolt.life >= bolt.maxLife) {
        bolt.active = false; mesh.visible = false;
        const target = ships.find(s => s.index === bolt.targetIndex && s.faction === bolt.targetFaction && s.alive);
        if (target && bolt.position.distanceTo(target.position) < 6) {
          const shieldMult = bolt.targetFaction === "rebel" ? rebelMults.shield : imperialMults.shield;
          target.hp -= bolt.damage / shieldMult;
          if (target.hp <= 0) {
            target.alive = false;
            explosionQueue.current.push(target.position.clone());
            onShipKill(target.faction);
          }
        }
        return;
      }
      bolt.position.addScaledVector(bolt.velocity, clampedDelta);
      mesh.position.copy(bolt.position);
      const dir = bolt.velocity.clone().normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      mesh.visible = true;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min((1 - bolt.life / bolt.maxLife) * 4, 0.95);
      mat.color.set(bolt.color);
    });
  });

  return <group ref={groupRef} />;
}

// ═══════════════════════════════════════════════════════════════
//  SCOREBOARD HUD (HTML overlay inside Canvas)
// ═══════════════════════════════════════════════════════════════

function BattleHUD({ score }: { score: BattleScore }) {
  return (
    <Html position={[BATTLE_CENTER[0], BATTLE_CENTER[1] + 22, BATTLE_CENTER[2]]} center distanceFactor={40}>
      <div style={{
        background: "rgba(0,0,0,0.75)", borderRadius: "6px", padding: "8px 16px",
        border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
        fontFamily: "monospace", pointerEvents: "none", minWidth: "220px",
      }}>
        <div style={{ fontSize: "8px", letterSpacing: "3px", color: "#888", textTransform: "uppercase" }}>
          Round {score.round}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "7px", color: "#ff4444", letterSpacing: "2px" }}>REBEL</div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#ff6644" }}>{score.rebel}</div>
            <div style={{ fontSize: "7px", color: "#666" }}>
              {score.rebelShipsLeft}S · {score.rebelFightersLeft}F
            </div>
          </div>
          <div style={{ fontSize: "10px", color: "#444" }}>vs</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "7px", color: "#44ff44", letterSpacing: "2px" }}>EMPIRE</div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#44ff88" }}>{score.imperial}</div>
            <div style={{ fontSize: "7px", color: "#666" }}>
              {score.imperialShipsLeft}S · {score.imperialFightersLeft}F
            </div>
          </div>
        </div>
        {score.gameOver && (
          <div style={{
            fontSize: "9px", letterSpacing: "2px", marginTop: "2px",
            color: score.winner === "rebel" ? "#ff6644" : "#44ff88",
            textTransform: "uppercase", fontWeight: "bold",
          }}>
            {score.winner === "rebel" ? "Rebel Alliance Wins!" : "Empire Wins!"}
            <div style={{ fontSize: "7px", color: "#555", fontWeight: "normal" }}>Restarting...</div>
          </div>
        )}
      </div>
    </Html>
  );
}

// ═══════════════════════════════════════════════════════════════
//  INITIALIZERS
// ═══════════════════════════════════════════════════════════════

function createInitialCapitalShips(): CapitalShipState[] {
  const ships: CapitalShipState[] = [];
  // 3 Star Destroyers
  const impPositions = [
    { pos: [BATTLE_CENTER[0] + 25, BATTLE_CENTER[1] + 5, BATTLE_CENTER[2] - 10], rot: [0, -0.8, 0.05] },
    { pos: [BATTLE_CENTER[0] + 20, BATTLE_CENTER[1] - 3, BATTLE_CENTER[2] + 15], rot: [0, -1.2, -0.03] },
    { pos: [BATTLE_CENTER[0] + 30, BATTLE_CENTER[1] + 2, BATTLE_CENTER[2] + 5], rot: [0, -0.5, 0.02] },
  ];
  impPositions.forEach((s, i) => {
    ships.push({
      position: new THREE.Vector3(...(s.pos as [number, number, number])),
      basePosition: new THREE.Vector3(...(s.pos as [number, number, number])),
      rotation: new THREE.Euler(...(s.rot as [number, number, number])),
      velocity: new THREE.Vector3(),
      hp: 100, maxHp: 100, alive: true, faction: "imperial", index: i,
      driftPhase: Math.random() * Math.PI * 2, driftSpeed: 0.1 + Math.random() * 0.15,
      assignedAgent: null,
    });
  });
  // 2 Mon Cal cruisers
  const rebPositions = [
    { pos: [BATTLE_CENTER[0] - 20, BATTLE_CENTER[1] - 2, BATTLE_CENTER[2] + 8], rot: [0, 0.6, -0.04] },
    { pos: [BATTLE_CENTER[0] - 18, BATTLE_CENTER[1] + 4, BATTLE_CENTER[2] - 12], rot: [0, 1.0, 0.03] },
  ];
  rebPositions.forEach((s, i) => {
    ships.push({
      position: new THREE.Vector3(...(s.pos as [number, number, number])),
      basePosition: new THREE.Vector3(...(s.pos as [number, number, number])),
      rotation: new THREE.Euler(...(s.rot as [number, number, number])),
      velocity: new THREE.Vector3(),
      hp: 120, maxHp: 120, alive: true, faction: "rebel", index: i + 10,
      driftPhase: Math.random() * Math.PI * 2, driftSpeed: 0.1 + Math.random() * 0.15,
      assignedAgent: null,
    });
  });
  return ships;
}

function createInitialFighters(): FighterData[] {
  return Array.from({ length: FIGHTER_COUNT }, (_, i) => {
    const isRebel = i < FIGHTER_COUNT / 2;
    const angle = Math.random() * Math.PI * 2;
    const r = 5 + Math.random() * BATTLE_RADIUS;
    const y = (Math.random() - 0.5) * 15;
    return {
      position: new THREE.Vector3(BATTLE_CENTER[0] + Math.cos(angle) * r, BATTLE_CENTER[1] + y, BATTLE_CENTER[2] + Math.sin(angle) * r),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5), (Math.random() - 0.5) * 2),
      target: new THREE.Vector3(),
      faction: isRebel ? "rebel" as const : "imperial" as const,
      alive: true, hp: 2, fireCooldown: Math.random() * 3, bankAngle: 0, evadeTimer: 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
//  CAPITAL SHIP MOVEMENT (drift toward enemies)
// ═══════════════════════════════════════════════════════════════

function CapitalShipAI({ capitalShips, rebelMults, imperialMults }: {
  capitalShips: React.MutableRefObject<CapitalShipState[]>;
  rebelMults: ReturnType<typeof getFactionMultipliers>;
  imperialMults: ReturnType<typeof getFactionMultipliers>;
}) {
  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.05);
    const ships = capitalShips.current;
    const aliveImps = ships.filter(s => s.faction === "imperial" && s.alive);
    const aliveRebs = ships.filter(s => s.faction === "rebel" && s.alive);

    ships.forEach(ship => {
      if (!ship.alive) return;
      const mults = ship.faction === "rebel" ? rebelMults : imperialMults;
      const enemies = ship.faction === "rebel" ? aliveImps : aliveRebs;

      // Slow drift toward nearest enemy
      if (enemies.length > 0) {
        let nearest = enemies[0];
        let nearestDist = Infinity;
        for (const e of enemies) {
          const d = ship.position.distanceTo(e.position);
          if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
        const toEnemy = new THREE.Vector3().subVectors(nearest.position, ship.position).normalize();
        // Don't get too close
        if (nearestDist > 15) {
          ship.velocity.lerp(toEnemy.multiplyScalar(1.5 * mults.speed), clampedDelta * 0.3);
        } else {
          // Orbit/hold distance
          const tangent = new THREE.Vector3(-toEnemy.z, 0, toEnemy.x);
          ship.velocity.lerp(tangent.multiplyScalar(0.8 * mults.speed), clampedDelta * 0.3);
        }
      }

      ship.position.addScaledVector(ship.velocity, clampedDelta);

      // Gentle oscillation
      ship.driftPhase += clampedDelta * ship.driftSpeed;
      ship.position.y += Math.sin(ship.driftPhase) * 0.01;
    });
  });

  return null;
}

// ═══════════════════════════════════════════════════════════════
//  MAIN BATTLE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

export interface EndorBattleProps {
  agents?: { callSign: string; specialty: string }[];
}

export function EndorBattle({ agents }: EndorBattleProps) {
  const [score, setScore] = useState<BattleScore>({
    rebel: 0, imperial: 0, round: 1,
    rebelShipsLeft: 2, imperialShipsLeft: 3,
    rebelFightersLeft: FIGHTER_COUNT / 2, imperialFightersLeft: FIGHTER_COUNT / 2,
    gameOver: false, winner: null, restartTimer: 0,
  });

  const capitalShips = useRef<CapitalShipState[]>(createInitialCapitalShips());
  const fighters = useRef<FighterData[]>(createInitialFighters());
  const explosionQueue = useRef<THREE.Vector3[]>([]);
  const restartTimerRef = useRef(0);
  const scoreRef = useRef(score);
  scoreRef.current = score;

  const { rebel: rebelBonuses, imperial: imperialBonuses } = useMemo(() => computeAgentBonuses(agents), [agents]);
  const rebelMults = useMemo(() => getFactionMultipliers(rebelBonuses), [rebelBonuses]);
  const imperialMults = useMemo(() => getFactionMultipliers(imperialBonuses), [imperialBonuses]);

  const lasersRef = useRef<LaserBolt[]>(
    Array.from({ length: MAX_LASERS }, () => ({
      from: new THREE.Vector3(), to: new THREE.Vector3(), color: "#ff2222",
      life: 0, maxLife: 0.3, active: false, damage: 1, targetFaction: "rebel" as const,
    }))
  );

  const laserCallback = useCallback((from: THREE.Vector3, to: THREE.Vector3, color: string, damage: number, targetFaction: "rebel" | "imperial") => {
    const laser = lasersRef.current.find(l => !l.active);
    if (laser) {
      laser.from.copy(from); laser.to.copy(to); laser.color = color;
      laser.life = 0; laser.maxLife = 0.2 + Math.random() * 0.15;
      laser.active = true; laser.damage = damage; laser.targetFaction = targetFaction;
    }
  }, []);

  const resetBattle = useCallback(() => {
    capitalShips.current = createInitialCapitalShips();
    fighters.current = createInitialFighters();
    lasersRef.current.forEach(l => { l.active = false; });
    explosionQueue.current = [];
    restartTimerRef.current = 0;
    scoreSyncTimer.current = 0;
  }, []);

  const onFighterKill = useCallback((faction: "rebel" | "imperial") => {
    setScore(prev => {
      const updated = { ...prev };
      if (faction === "rebel") {
        updated.rebelFightersLeft = Math.max(0, prev.rebelFightersLeft - 1);
        updated.imperial += 1;
      } else {
        updated.imperialFightersLeft = Math.max(0, prev.imperialFightersLeft - 1);
        updated.rebel += 1;
      }
      return updated;
    });
  }, []);

  const onShipKill = useCallback((faction: "rebel" | "imperial") => {
    setScore(prev => {
      const updated = { ...prev };
      if (faction === "rebel") {
        updated.rebelShipsLeft = Math.max(0, prev.rebelShipsLeft - 1);
        updated.imperial += 10; // Capital ships worth more
      } else {
        updated.imperialShipsLeft = Math.max(0, prev.imperialShipsLeft - 1);
        updated.rebel += 10;
      }
      return updated;
    });
  }, []);

  // Game over + restart check (throttled to avoid per-frame re-renders)
  const scoreSyncTimer = useRef(0);
  useFrame((_, delta) => {
    const s = scoreRef.current;
    const aliveRebFighters = fighters.current.filter(f => f.faction === "rebel" && f.alive).length;
    const aliveImpFighters = fighters.current.filter(f => f.faction === "imperial" && f.alive).length;
    const aliveRebShips = capitalShips.current.filter(sh => sh.faction === "rebel" && sh.alive).length;
    const aliveImpShips = capitalShips.current.filter(sh => sh.faction === "imperial" && sh.alive).length;

    const rebAlive = aliveRebFighters + aliveRebShips;
    const impAlive = aliveImpFighters + aliveImpShips;

    if (!s.gameOver && (rebAlive === 0 || impAlive === 0)) {
      const winner = rebAlive === 0 ? "imperial" as const : "rebel" as const;
      setScore(prev => ({ ...prev, gameOver: true, winner }));
      restartTimerRef.current = 0;
    }

    if (s.gameOver) {
      restartTimerRef.current += delta;
      if (restartTimerRef.current >= RESTART_DELAY) {
        resetBattle();
        setScore(prev => ({
          rebel: prev.rebel, imperial: prev.imperial, round: prev.round + 1,
          rebelShipsLeft: 2, imperialShipsLeft: 3,
          rebelFightersLeft: FIGHTER_COUNT / 2, imperialFightersLeft: FIGHTER_COUNT / 2,
          gameOver: false, winner: null, restartTimer: 0,
        }));
      }
    }

    // Sync live counts — throttled to ~1Hz to avoid thrashing React
    scoreSyncTimer.current += delta;
    if (!s.gameOver && scoreSyncTimer.current >= 1.0) {
      scoreSyncTimer.current = 0;
      if (
        s.rebelFightersLeft !== aliveRebFighters ||
        s.imperialFightersLeft !== aliveImpFighters ||
        s.rebelShipsLeft !== aliveRebShips ||
        s.imperialShipsLeft !== aliveImpShips
      ) {
        setScore(prev => ({
          ...prev,
          rebelFightersLeft: aliveRebFighters,
          imperialFightersLeft: aliveImpFighters,
          rebelShipsLeft: aliveRebShips,
          imperialShipsLeft: aliveImpShips,
        }));
      }
    }
  });

  const sdGeo = useMemo(() => createStarDestroyerGeometry(), []);
  const mcGeo = useMemo(() => createMonCalGeometry(), []);

  return (
    <group>
      <DeathStar position={[BATTLE_CENTER[0] + 50, BATTLE_CENTER[1] + 15, BATTLE_CENTER[2] - 30]} />
      <EndorMoon />

      {capitalShips.current.map(ship => (
        <CapitalShipMesh
          key={`${ship.faction}-${ship.index}`}
          ship={ship}
          geometry={ship.faction === "imperial" ? sdGeo : mcGeo}
        />
      ))}

      <CapitalShipAI capitalShips={capitalShips} rebelMults={rebelMults} imperialMults={imperialMults} />

      <FighterSwarm
        laserCallback={laserCallback}
        fighters={fighters}
        rebelMults={rebelMults}
        imperialMults={imperialMults}
      />
      <LaserBolts lasersRef={lasersRef} fighters={fighters} onFighterKill={onFighterKill} />
      <TurbolaserExchanges
        capitalShips={capitalShips}
        rebelMults={rebelMults}
        imperialMults={imperialMults}
        onShipKill={onShipKill}
        explosionQueue={explosionQueue}
      />
      <ExplosionParticles explosionQueue={explosionQueue} />
      <MillenniumFalcon
        laserCallback={laserCallback}
        imperialFighters={fighters}
        capitalShips={capitalShips}
        explosionQueue={explosionQueue}
        onFighterKill={onFighterKill}
      />

      <BattleHUD score={score} />

      <pointLight position={BATTLE_CENTER} color="#ff6633" intensity={0.8} distance={50} />
      <pointLight position={[BATTLE_CENTER[0] + 20, BATTLE_CENTER[1], BATTLE_CENTER[2]]} color="#4466ff" intensity={0.4} distance={30} />
    </group>
  );
}
