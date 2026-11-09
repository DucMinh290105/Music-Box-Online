'use client';
import {useMemo} from 'react';
import {useLoader} from '@react-three/fiber';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {ROOM_MODEL_URL} from '../data/room';

/**
 * Filter a mesh geometry by keeping only triangles where `keepTriangle(vi0, vi1, vi2)` returns true.
 */
function filterGeometryTriangles(
 geom: THREE.BufferGeometry,
 keepTriangle: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => boolean
): THREE.BufferGeometry {
 const pos = geom.getAttribute('position');
 if (!pos) return geom;
 const cloned = geom.clone();
 const idx = cloned.getIndex();
 if (idx) {
  const arr = idx.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
   const a = arr[i], b = arr[i + 1], c = arr[i + 2];
   const keep = keepTriangle(
    pos.getX(a), pos.getY(a), pos.getZ(a),
    pos.getX(b), pos.getY(b), pos.getZ(b),
    pos.getX(c), pos.getY(c), pos.getZ(c)
   );
   if (!keep) {
    arr[i] = 0;
    arr[i + 1] = 0;
    arr[i + 2] = 0;
   }
  }
  idx.needsUpdate = true;
 }
 return cloned;
}

/** Check if a vertex belongs to floating side-wall frames or the 2 3D wall shelves beside the TV. */
function isRemovedWallDecorVertex(x: number, y: number, z: number): boolean {
 // 1. Floating picture frames / photo boards on left & right walls (photo_board_31, frame_32, frame_33, music_note_wall_34)
 if (Math.abs(x) > 8.65 && y > 2.2 && z > -5.8) return true;
 // 2. 3D wall shelves beside the TV (wall_shelf_27, wall_shelf_28, wall_shelf_29, wall_shelf_30)
 if (Math.abs(x) >= 3.1 && Math.abs(x) <= 6.35 && y >= 2.20 && y <= 3.20 && z <= -6.20) return true;
 return false;
}

/** Check if a vertex belongs to front-wall TV/speaker protrusions (z < -5.82) that should hide when looking from TV toward player. */
function isFrontWallProtrusionVertex(x: number, y: number, z: number): boolean {
 return z < -5.82 && Math.abs(x) < 4.5 && y > 0.03;
}

export default function RoomLoader(){
 const gltf=useLoader(GLTFLoader,ROOM_MODEL_URL);
 const obj=useMemo(()=>{
  const scene=gltf.scene.clone(true);
  scene.name='MusicBox_Real3D_GLTF';
  const frontWallGroup=new THREE.Group();
  frontWallGroup.name='front_wall_protrusions';

  const meshes: THREE.Mesh[] = [];
  scene.traverse(o=>{
   if(o instanceof THREE.Mesh) meshes.push(o);
  });

  for(const o of meshes){
   // Hide duplicate flat exports & hanging ceiling spheres/tubes that intrude into upper camera view
   if(['static_group_13','static_group_15','static_group_19','static_group_20'].includes(o.name)){
    o.visible=false;
    continue;
   }

   if(!o.geometry.getAttribute('normal'))o.geometry.computeVertexNormals();
   o.castShadow=false;o.receiveShadow=false;
   o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();
   const materials=Array.isArray(o.material)?o.material:[o.material];
   for(const material of materials){
    if(material instanceof THREE.MeshStandardMaterial && !material.map){
     material.color.convertSRGBToLinear();
     material.color.multiply(new THREE.Color('#faf2eb'));
     material.flatShading=false;
     material.needsUpdate=true;
    }
    if(material instanceof THREE.MeshStandardMaterial && material.map){
     material.color.set('#f5ede6');
     material.map.colorSpace=THREE.SRGBColorSpace;
     material.side=THREE.DoubleSide;
     material.emissive.set('#ffeedd');
     material.emissiveMap=material.map;
     material.emissiveIntensity=0.26;
    }
   }

   // If this mesh is purely part of the TV/speaker assembly (static_group_16, 17, 18), move it into frontWallGroup
   if(['static_group_16','static_group_17','static_group_18'].includes(o.name)){
    const cloneMesh=o.clone();
    frontWallGroup.add(cloneMesh);
    o.visible=false;
    continue;
   }

   if(o.name.startsWith('static_group_')&&!['static_group_23','static_group_24'].includes(o.name)){
    const baseGeom = o.geometry;
    // Main room geometry: exclude removed wall decor AND exclude front-wall TV/speaker protrusions
    o.geometry = filterGeometryTriangles(baseGeom, (x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
     if (isRemovedWallDecorVertex(x0, y0, z0) || isRemovedWallDecorVertex(x1, y1, z1) || isRemovedWallDecorVertex(x2, y2, z2)) {
      return false;
     }
     if (isFrontWallProtrusionVertex(x0, y0, z0) || isFrontWallProtrusionVertex(x1, y1, z1) || isFrontWallProtrusionVertex(x2, y2, z2)) {
      return false;
     }
     return true;
    });

    // Front wall protrusion geometry (TV cabinet, TV arch, speaker plants): only visible when not looking from TV toward player
    const frontGeom = filterGeometryTriangles(baseGeom, (x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
     if (isRemovedWallDecorVertex(x0, y0, z0) || isRemovedWallDecorVertex(x1, y1, z1) || isRemovedWallDecorVertex(x2, y2, z2)) {
      return false;
     }
     return isFrontWallProtrusionVertex(x0, y0, z0) || isFrontWallProtrusionVertex(x1, y1, z1) || isFrontWallProtrusionVertex(x2, y2, z2);
    });
    const frontMesh = new THREE.Mesh(frontGeom, o.material);
    frontMesh.name = `${o.name}_front`;
    frontMesh.position.copy(o.position);
    frontMesh.rotation.copy(o.rotation);
    frontMesh.scale.copy(o.scale);
    frontWallGroup.add(frontMesh);
   }
  }

  scene.add(frontWallGroup);
  return scene;
 },[gltf]);
 return <primitive object={obj} dispose={null}/>;
}
