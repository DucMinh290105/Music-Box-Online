'use client';
import {useMemo} from 'react';
import {useLoader} from '@react-three/fiber';
import * as THREE from 'three';
import {ROOM} from '../data/room';
/** Six orthographic, cropped pastel artwork panels with subtle cozy dimming and clean pastel tone. */
const URLS=['/textures/room/front-clean.webp','/textures/room/left.webp','/textures/room/right.webp',
 '/textures/room/back.webp','/textures/room/floor.webp','/textures/room/ceiling.webp'];
export default function RoomWallTextures(){
 const sources=useLoader(THREE.TextureLoader,URLS);
 const maps=useMemo(()=>sources.map((t)=>{
  const copy=t.clone();copy.colorSpace=THREE.SRGBColorSpace;
  copy.wrapS=THREE.ClampToEdgeWrapping;copy.wrapT=THREE.ClampToEdgeWrapping;
  copy.anisotropy=4;copy.needsUpdate=true;return copy;
 }),[sources]);
 const [w,,d]=ROOM.roomSize;const h=5.7,centerY=h/2;
 return <group name="AI_Pastel_Wall_Skin">
  <mesh name="front_wall_art" position={[0,centerY,-d/2+0.14]}>
   <planeGeometry args={[w-0.10,h]}/><meshBasicMaterial map={maps[0]} color="#dfd3d5" toneMapped={false} side={THREE.DoubleSide}/></mesh>
  <mesh name="left_wall_art" position={[-w/2+0.14,centerY,0]} rotation={[0,Math.PI/2,0]}>
   <planeGeometry args={[d-0.10,h]}/><meshBasicMaterial map={maps[1]} color="#dfd3d5" toneMapped={false} side={THREE.DoubleSide}/></mesh>
  <mesh name="right_wall_art" position={[w/2-0.14,centerY,0]} rotation={[0,-Math.PI/2,0]}>
   <planeGeometry args={[d-0.10,h]}/><meshBasicMaterial map={maps[2]} color="#dfd3d5" toneMapped={false} side={THREE.DoubleSide}/></mesh>
  <mesh name="back_wall_art" position={[0,centerY,d/2-0.14]} rotation={[0,Math.PI,0]}>
   <planeGeometry args={[w-0.10,h]}/><meshBasicMaterial map={maps[3]} color="#dfd3d5" toneMapped={false} side={THREE.DoubleSide}/></mesh>
  <mesh name="floor_art" position={[0,0.046,0]} rotation={[-Math.PI/2,0,0]}>
   <planeGeometry args={[w-0.10,d-0.10]}/><meshBasicMaterial map={maps[4]} color="#d6c5bc" toneMapped={false}/></mesh>
  <mesh name="ceiling_art" position={[0,5.82,0]} rotation={[Math.PI/2,0,0]}>
   <planeGeometry args={[w-0.10,d-0.10]}/><meshBasicMaterial color="#e4d6d9" side={THREE.DoubleSide} toneMapped={false}/></mesh>
 </group>;
}
