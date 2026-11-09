'use client';
import {useMemo} from 'react';
import * as THREE from 'three';

function createStarShape(outerR: number, innerR: number, points = 5) {
 const shape = new THREE.Shape();
 for (let i = 0; i < points * 2; i++) {
  const r = i % 2 === 0 ? outerR : innerR;
  const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  if (i === 0) shape.moveTo(x, y);
  else shape.lineTo(x, y);
 }
 shape.closePath();
 return shape;
}

export default function RoomFinishes() {
 const centerStarShape = useMemo(() => createStarShape(1.05, 0.52, 5), []);
 const smallStarShape = useMemo(() => createStarShape(0.24, 0.12, 5), []);

 return (
  <group name="room-finishes-reference-decor">
   {/* ======================================================== */}
   {/* 1. CEILING ARCHITECTURE: BEAMS, COVE LIGHTS, CHANDELIER  */}
   {/* ======================================================== */}
   {/* Warm Wood Ceiling Rafters / Beams running front-to-back */}
   {[-6.8, -3.4, 0, 3.4, 6.8].map((x, i) => (
    <mesh key={`beam-${i}`} position={[x, 5.76, 0]}>
     <boxGeometry args={[0.26, 0.22, 14.1]} />
     <meshStandardMaterial color="#b47852" roughness={0.75} metalness={0.05} />
    </mesh>
   ))}

   {/* Perimeter Recessed Cove Lighting Strips (Soft Warm-Pink Glow) */}
   <mesh position={[0, 5.72, -6.92]}>
    <boxGeometry args={[18.1, 0.09, 0.14]} />
    <meshStandardMaterial color="#ffa6c4" emissive="#ff88b2" emissiveIntensity={1.15} roughness={0.2} />
   </mesh>
   <mesh position={[-9.02, 5.72, 0]}>
    <boxGeometry args={[0.14, 0.09, 14.0]} />
    <meshStandardMaterial color="#ffa6c4" emissive="#ff88b2" emissiveIntensity={1.05} roughness={0.2} />
   </mesh>
   <mesh position={[9.02, 5.72, 0]}>
    <boxGeometry args={[0.14, 0.09, 14.0]} />
    <meshStandardMaterial color="#ffa6c4" emissive="#ff88b2" emissiveIntensity={1.05} roughness={0.2} />
   </mesh>

   {/* Central Circular Star Chandelier */}
   <group position={[0, 5.38, -0.4]}>
    <mesh position={[0, 0.2, 0]}>
     <cylinderGeometry args={[1.38, 1.45, 0.18, 48]} />
     <meshStandardMaterial color="#e6b8d2" roughness={0.5} />
    </mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
     <torusGeometry args={[1.18, 0.12, 20, 64]} />
     <meshStandardMaterial color="#d890b6" emissive="#c06ea0" emissiveIntensity={0.38} roughness={0.35} />
    </mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
     <torusGeometry args={[1.02, 0.06, 16, 64]} />
     <meshStandardMaterial color="#fff6e2" emissive="#ffe4a8" emissiveIntensity={1.45} roughness={0.2} />
    </mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
     <extrudeGeometry args={[centerStarShape, {depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03}]} />
     <meshStandardMaterial color="#fff0ba" emissive="#ffd884" emissiveIntensity={0.62} roughness={0.5} />
    </mesh>
    {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a, i) => (
     <mesh key={i} position={[Math.cos(a) * 0.95, 0.18, Math.sin(a) * 0.95]}>
      <cylinderGeometry args={[0.016, 0.016, 0.38, 8]} />
      <meshStandardMaterial color="#d5a26c" metalness={0.4} />
     </mesh>
    ))}
   </group>

   {/* ======================================================== */}
   {/* 2. RUGS (Non-overlapping, cleanly spaced on wood floor)  */}
   {/* ======================================================== */}
   {/* Left Curved Sofa Area Rug (spans X: -6.30 to -2.60) */}
   <group position={[-4.45, 0.048, -0.25]}>
    <mesh scale={[1.85, 1, 1.38]}>
     <cylinderGeometry args={[1, 1, 0.014, 64]} />
     <meshStandardMaterial color="#ecb0c6" roughness={0.95} />
    </mesh>
    <mesh position={[0, 0.008, 0]} scale={[1.6, 1, 1.16]}>
     <cylinderGeometry args={[1, 1, 0.012, 64]} />
     <meshStandardMaterial color="#f6dae2" roughness={0.95} />
    </mesh>
   </group>

   {/* Right Curved Sofa Area Rug (spans X: +2.60 to +6.30) */}
   <group position={[4.45, 0.048, -0.25]}>
    <mesh scale={[1.85, 1, 1.38]}>
     <cylinderGeometry args={[1, 1, 0.014, 64]} />
     <meshStandardMaterial color="#d2c1e6" roughness={0.95} />
    </mesh>
    <mesh position={[0, 0.008, 0]} scale={[1.6, 1, 1.16]}>
     <cylinderGeometry args={[1, 1, 0.012, 64]} />
     <meshStandardMaterial color="#e8dff2" roughness={0.95} />
    </mesh>
   </group>

   {/* Center Lounge Seating Rug (spans X: -1.95 to +1.95, Z: -2.20 to +0.50 — zero overlap!) */}
   <group position={[0, 0.048, -0.85]}>
    <mesh scale={[1.95, 1, 1.35]}>
     <cylinderGeometry args={[1, 1, 0.014, 64]} />
     <meshStandardMaterial color="#e2c8ea" roughness={0.95} />
    </mesh>
    <mesh position={[0, 0.008, 0]} scale={[1.7, 1, 1.14]}>
     <cylinderGeometry args={[1, 1, 0.012, 64]} />
     <meshStandardMaterial color="#f8e6ef" roughness={0.95} />
    </mesh>
   </group>

   {/* Back-Center Sofa Lounge Rug (spans X: -1.90 to +1.90, Z: +1.65 to +3.75 — cleanly separated!) */}
   <group position={[0, 0.048, 2.7]}>
    <mesh scale={[1.9, 1, 1.05]}>
     <cylinderGeometry args={[1, 1, 0.014, 64]} />
     <meshStandardMaterial color="#edd8ca" roughness={0.95} />
    </mesh>
    <mesh position={[0, 0.008, 0]} scale={[1.65, 1, 0.88]}>
     <cylinderGeometry args={[1, 1, 0.012, 64]} />
     <meshStandardMaterial color="#fbf1e9" roughness={0.95} />
    </mesh>
   </group>

   {/* ======================================================== */}
   {/* 3. SIDE POUFS, 3D HI-FI SPEAKERS & NEON ARCH ORNAMENTS   */}
   {/* ======================================================== */}
   {/* Left Side Poufs */}
   <mesh position={[-4.5, 0.22, 1.1]}>
    <cylinderGeometry args={[0.34, 0.34, 0.32, 32]} />
    <meshStandardMaterial color="#f5c4d4" roughness={0.85} />
   </mesh>
   <mesh position={[-3.2, 0.22, 1.1]}>
    <cylinderGeometry args={[0.34, 0.34, 0.32, 32]} />
    <meshStandardMaterial color="#d6c4ea" roughness={0.85} />
   </mesh>

   {/* Right Side Poufs */}
   <mesh position={[4.5, 0.22, 1.1]}>
    <cylinderGeometry args={[0.34, 0.34, 0.32, 32]} />
    <meshStandardMaterial color="#d3c0eb" roughness={0.85} />
   </mesh>
   <mesh position={[3.2, 0.22, 1.1]}>
    <cylinderGeometry args={[0.34, 0.34, 0.32, 32]} />
    <meshStandardMaterial color="#f8dde7" roughness={0.85} />
   </mesh>

   {/* Front Wall Ornaments & Complete 3D Floor-Standing Hi-Fi Speakers */}
   <group name="front_wall_arch_stars">
    {/* Hanging Star Ornaments Left & Right of TV Arch */}
    <group position={[0, 3.65, -6.65]}>
     {[-3.05, 3.05].map((x, i) => (
      <group key={`arch-star-${i}`} position={[x, -0.15, 0.05]}>
       <mesh position={[0, 0.24, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.48, 8]} />
        <meshStandardMaterial color="#e0b078" metalness={0.5} />
       </mesh>
       <mesh position={[0, 0, 0]}>
        <extrudeGeometry args={[smallStarShape, {depth: 0.04, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015}]} />
        <meshStandardMaterial color="#fff0ad" emissive="#ffd870" emissiveIntensity={0.95} />
       </mesh>
      </group>
     ))}
    </group>

    {/* Left & Right 3D Floor-Standing Hi-Fi Speakers beside TV Console */}
    {[-3.75, 3.75].map((spkX, i) => (
     <group key={`hifi-speaker-${i}`} position={[spkX, 0, -6.36]}>
      {/* Wooden Base Pedestal on Floor */}
      <mesh position={[0, 0.08, 0]}>
       <boxGeometry args={[0.56, 0.07, 0.48]} />
       <meshStandardMaterial color="#cfa07a" roughness={0.65} />
      </mesh>
      {/* Wooden Stand Pillar */}
      <mesh position={[0, 0.52, -0.02]}>
       <cylinderGeometry args={[0.08, 0.1, 0.84, 24]} />
       <meshStandardMaterial color="#d8ab86" roughness={0.6} />
      </mesh>
      {/* Top Stand Plate */}
      <mesh position={[0, 0.94, 0]}>
       <boxGeometry args={[0.52, 0.04, 0.44]} />
       <meshStandardMaterial color="#cfa07a" roughness={0.65} />
      </mesh>
      {/* Outer Warm-Wood Speaker Cabinet Wrap */}
      <mesh position={[0, 1.56, -0.01]}>
       <boxGeometry args={[0.56, 1.20, 0.44]} />
       <meshStandardMaterial color="#d8a48f" roughness={0.55} />
      </mesh>
      {/* Matte Dark Acoustic Front Baffle */}
      <mesh position={[0, 1.56, 0.02]}>
       <boxGeometry args={[0.50, 1.12, 0.40]} />
       <meshStandardMaterial color="#342b3d" roughness={0.45} />
      </mesh>
      {/* Upper Tweeter Gold Ring (Facing Forward +Z) */}
      <mesh position={[0, 1.84, 0.225]}>
       <torusGeometry args={[0.12, 0.022, 16, 36]} />
       <meshStandardMaterial color="#f0c475" metalness={0.45} roughness={0.3} />
      </mesh>
      {/* Upper Tweeter Cone */}
      <mesh position={[0, 1.84, 0.215]} rotation={[Math.PI / 2, 0, 0]}>
       <cylinderGeometry args={[0.11, 0.07, 0.02, 32]} />
       <meshStandardMaterial color="#d6bce8" roughness={0.5} />
      </mesh>
      {/* Upper Tweeter Center Dome */}
      <mesh position={[0, 1.84, 0.228]}>
       <sphereGeometry args={[0.042, 20, 16]} />
       <meshStandardMaterial color="#f5d5e6" roughness={0.35} />
      </mesh>
      {/* Lower Woofer Gold Ring (Facing Forward +Z) */}
      <mesh position={[0, 1.34, 0.225]}>
       <torusGeometry args={[0.175, 0.026, 18, 42]} />
       <meshStandardMaterial color="#f0c475" metalness={0.45} roughness={0.3} />
      </mesh>
      {/* Lower Woofer Cone */}
      <mesh position={[0, 1.34, 0.215]} rotation={[Math.PI / 2, 0, 0]}>
       <cylinderGeometry args={[0.165, 0.11, 0.024, 36]} />
       <meshStandardMaterial color="#cbb0e2" roughness={0.5} />
      </mesh>
      {/* Lower Woofer Center Dome */}
      <mesh position={[0, 1.34, 0.23]}>
       <sphereGeometry args={[0.06, 20, 16]} />
       <meshStandardMaterial color="#f7dce9" roughness={0.35} />
      </mesh>
      {/* Bass Reflex Port Slot */}
      <mesh position={[0, 1.08, 0.222]}>
       <boxGeometry args={[0.22, 0.035, 0.01]} />
       <meshStandardMaterial color="#1d1624" roughness={0.8} />
      </mesh>
     </group>
    ))}
   </group>
  </group>
 );
}
