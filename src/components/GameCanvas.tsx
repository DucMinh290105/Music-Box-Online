'use client';
import {Canvas} from '@react-three/fiber';
import * as THREE from 'three';
import GameWorld,{type GameWorldProps} from '@/game/GameWorld';
import {Component,Suspense,type ErrorInfo,type ReactNode} from 'react';
class SceneErrorBoundary extends Component<{children:ReactNode},{error:string|null}>{
 state={error:null as string|null};
 static getDerivedStateFromError(error:Error){return {error:error.message};}
 componentDidCatch(error:Error,_info:ErrorInfo){console.error('3D scene error:',error);}
 render(){return this.state.error?<div className="webgl-error" role="alert"><h2>Không thể mở phòng 3D</h2><p>{this.state.error}</p><p>Hãy kiểm tra tăng tốc phần cứng WebGL, Chrome/Edge/Safari mới và tải lại trang.</p></div>:this.props.children;}
}
export default function GameCanvas({sceneExtensions,...worldProps}:GameWorldProps & {sceneExtensions?:ReactNode}){
 return <SceneErrorBoundary>
  <Canvas
   style={{position:'relative',zIndex:2}}
   shadows={false}
   dpr={[1,1.6]}
   camera={{fov:68,near:.06,far:120,position:[0,2.6,7.2]}}
   gl={{antialias:true,alpha:true,powerPreference:'high-performance'}}
   onCreated={({gl,scene})=>{
     gl.outputColorSpace=THREE.SRGBColorSpace;
     gl.toneMapping=THREE.ACESFilmicToneMapping;
     gl.toneMappingExposure=0.84;
     gl.shadowMap.enabled=false;
     scene.background=new THREE.Color('#dfd2d6');
     scene.fog=new THREE.Fog('#dfd2d6',29,75);
   }}
  >
   <Suspense fallback={null}><GameWorld {...worldProps}/></Suspense>
   {sceneExtensions}
  </Canvas>
 </SceneErrorBoundary>;
}
