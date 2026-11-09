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
   {/* 2. RUGS (Center, Left, Right)                             */}
   {/* ======================================================== */}
   {/* Left Curved Sofa Area Rug */}
   <group position={[-4.8, 0.048, -0.2]}>
    <mesh scale={[2.5, 1, 1.6]}>
     <cylinderGeometry args={[1, 1, 0.015, 64]} />
     <meshStandardMaterial color="#ecb0c6" roughness={1} />
    </mesh>
    <mesh position={[0, 0.009, 0]} scale={[2.2, 1, 1.35]}>
     <cylinderGeometry args={[1, 1, 0.012, 64]} />
     <meshStandardMaterial color="#f6dae2" roughness={1} />
    </mesh>
   </group>

   {/* Right Curved Sofa Area Rug */}
   <group position={[4.8, 0.048, -0.2]}>
    <mesh scale={[2.5, 1, 1.6]}>
     <cylinderGeometry args={[1, 1, 0.015, 64]} />
     <meshStandardMaterial color="#d2c1e6" roughness={1} />
    </mesh>
    <mesh position={[0, 0.009, 0]} scale={[2.2, 1, 1.35]}>
     <cylinderGeometry args={[1, 1, 0.012, 64]} />
     <meshStandardMaterial color="#e8dff2" roughness={1} />
    </mesh>
   </group>

   {/* Center Lounge Seating Rug */}
   <group position={[0, 0.048, -0.6]}>
    <mesh scale={[2.6, 1, 1.7]}>
     <cylinderGeometry args={[1, 1, 0.015, 64]} />
     <meshStandardMaterial color="#e2c8ea" roughness={1} />
    </mesh>
    <mesh position={[0, 0.009, 0]} scale={[2.3, 1, 1.45]}>
     <cylinderGeometry args={[1, 1, 0.012, 64]} />
     <meshStandardMaterial color="#f8e6ef" roughness={1} />
    </mesh>
   </group>

   {/* ======================================================== */}
   {/* 3. SIDE POUFS & SUBTLE NEON ARCH ORNAMENTS               */}
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

   {/* Hanging Star Ornaments Left & Right of TV Arch */}
   <group name="front_wall_arch_stars" position={[0, 3.65, -6.65]}>
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
  </group>
 );
}
