'use client';
import {useEffect,useMemo,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import RoomLoader from './assets/RoomLoader';
import RoomFinishes from './assets/RoomFinishes';
import RoomWallTextures from './assets/RoomWallTextures';
import {ROOM_SIZES,type RoomSizeMode} from './data/roomSizes';
import {ROOM,ROOM_TV_IMAGE_URL} from './data/room';
import {ChibiAvatar} from './actors/ChibiAvatar.js';
import {findCharacter} from './actors/roster';
import {combinedInput,cameraRelative,WALK_SPEED,RUN_SPEED} from './core/movement';
import {resolveMovement} from './controllers/CollisionManager';
import {nearestInteraction,type Interaction} from './controllers/InteractionManager';
import {makeSeatRuntime,startSitting,startStanding,updateSeat,type SeatPose} from './controllers/SeatController';
import {constrainCamera} from './controllers/CameraController';
import {type Controls,resetCamera} from './input/controller';
import {localGameSink,type GameEventSink,type AvatarAction} from './ports/GameBridge';
import type {RoomMember} from '@/lib/types/realtime';

export type WorldStatus={x:number;z:number;fps:number;action:string;seated:boolean;near:Interaction|null;avatarReady:boolean;seatPhase:string};
export type WorldAction={type:'tv';source:HTMLCanvasElement}|{type:'notice';message:string};
export interface TvOverlayRefs {
 stage:React.RefObject<HTMLDivElement|null>;
 camera:React.RefObject<HTMLDivElement|null>;
 screen:React.RefObject<HTMLDivElement|null>;
}
export interface TvMediaInfo {
 videoId:string;
 title:string;
 playing:boolean;
 currentTime:number;
 duration:number;
}
export interface LocalPlayerPose {
 x:number;
 y:number;
 z:number;
 yaw:number;
 action:string;
 seated:boolean;
}
export interface GameWorldProps {
 avatarId:string;roomSizeMode:RoomSizeMode;controls:React.RefObject<Controls>;eventSink?:GameEventSink;
 tvOverlayRefs?:TvOverlayRefs;
 tvMedia?:TvMediaInfo;
 playerName?:string;
 playerRole?:string;
 playerMuted?:boolean;
 playerAudioLevel?:number;
 remoteMembers?:RoomMember[];
 onLocalPose?:(pose:LocalPlayerPose)=>void;
 onStatus:(state:WorldStatus)=>void;onAction:(act:WorldAction)=>void;
}
type AvatarRuntime={root:THREE.Object3D;setAction:(action:string,options?:{duration?:number})=>boolean;update:(dt:number)=>void;dispose:()=>void;state:string};
const clamp=THREE.MathUtils.clamp;
const getPose=(g:THREE.Group):SeatPose=>({x:g.position.x,y:g.position.y,z:g.position.z,yaw:g.rotation.y});
const eps=(n:number)=>(Math.abs(n)<1e-10?0:n);

function drawNametagCanvas(
 canvas:HTMLCanvasElement,
 rawName:string,
 role?:string,
 isMuted:boolean=true,
 audioLevel:number=0
){
 const ctx=canvas.getContext('2d');
 if(!ctx)return;
 const W=canvas.width,H=canvas.height;
 ctx.clearRect(0,0,W,H);

 const isSinging=!isMuted&&audioLevel>6;
 const cleanName=(rawName||'Khách').trim().slice(0,18);
 const rolePrefix=role==='admin'?'👑 ':role==='host'?'🏠 ':'';
 const micSuffix=!isMuted?' 🔊':'';
 const label=`${rolePrefix}${cleanName}${micSuffix}`;

 ctx.font='900 38px "Segoe UI", Arial, sans-serif';
 const textWidth=ctx.measureText(label).width;
 const boxW=Math.min(W-16,Math.max(220,Math.ceil(textWidth+68)));
 const boxH=76;
 const boxX=(W-boxW)/2;
 const boxY=(H-boxH)/2;

 // Semi-transparent black background ("nền đen transparency")
 ctx.fillStyle='rgba(8, 8, 12, 0.72)';
 ctx.beginPath();
 ctx.roundRect(boxX,boxY,boxW,boxH,38);
 ctx.fill();

 // Subtle golden/singing border
 ctx.strokeStyle=isSinging?'#4ade80':'rgba(255, 204, 0, 0.78)';
 ctx.lineWidth=3.5;
 ctx.stroke();

 // Dark outline + Bold Golden Yellow text ("chữ vàng đậm dễ nhìn")
 ctx.textAlign='center';
 ctx.textBaseline='middle';
 ctx.lineJoin='round';
 ctx.strokeStyle='rgba(0, 0, 0, 0.92)';
 ctx.lineWidth=6;
 ctx.strokeText(label,W/2,H/2+1);

 ctx.fillStyle='#FFCC00';
 ctx.fillText(label,W/2,H/2+1);
}

function RemoteAvatarActor({member}:{member:RoomMember}){
 const groupRef=useRef<THREE.Group>(null!);
 const nametagMeshRef=useRef<THREE.Mesh>(null!);
 const avatarRef=useRef<AvatarRuntime|null>(null);
 const currentActionRef=useRef<string>('idle');
 const avatarId=member.avatarId||'chibi-01';
 const targetPos=useRef(new THREE.Vector3(member.x??0,member.y??0,member.z??1.6));
 const targetYaw=useRef(member.yaw??Math.PI);

 useEffect(()=>{
  targetPos.current.set(member.x??0,member.y??0,member.z??1.6);
  targetYaw.current=member.yaw??Math.PI;
 },[member.x,member.y,member.z,member.yaw]);

 useEffect(()=>{
  let cancelled=false;
  const character=findCharacter(avatarId);
  const host=groupRef.current;
  void ChibiAvatar.load(character).then((obj:AvatarRuntime)=>{
   if(cancelled){obj.dispose();return;}
   if(avatarRef.current){host.remove(avatarRef.current.root);avatarRef.current.dispose();}
   avatarRef.current=obj;
   host.add(obj.root);
   obj.setAction(member.action||'idle');
   currentActionRef.current=member.action||'idle';
  }).catch(()=>{});
  return ()=>{
   cancelled=true;
   if(avatarRef.current&&host){
    host.remove(avatarRef.current.root);
    avatarRef.current.dispose();
    avatarRef.current=null;
   }
  };
 },[avatarId]);

 const badgeTexture=useMemo(()=>{
  if(typeof document==='undefined')return null;
  const c=document.createElement('canvas');
  c.width=512;c.height=112;
  const tex=new THREE.CanvasTexture(c);
  tex.colorSpace=THREE.SRGBColorSpace;
  return {canvas:c,tex};
 },[]);

 useEffect(()=>{
  if(!badgeTexture)return;
  const effectiveRole=member.isSuperAdmin?'admin':member.isHost?'host':member.role;
  drawNametagCanvas(badgeTexture.canvas,member.name,effectiveRole,member.isMuted,member.audioLevel||0);
  badgeTexture.tex.needsUpdate=true;
 },[badgeTexture,member.name,member.role,member.isSuperAdmin,member.isHost,member.isMuted,member.audioLevel]);

 useEffect(()=>()=>{badgeTexture?.tex.dispose();},[badgeTexture]);

 useFrame((_,rawDt)=>{
  const dt=Math.min(0.05,rawDt);
  const g=groupRef.current;
  if(!g)return;
  const ease=1-Math.exp(-10*dt);
  g.position.lerp(targetPos.current,ease);
  const diff=Math.atan2(Math.sin(targetYaw.current-g.rotation.y),Math.cos(targetYaw.current-g.rotation.y));
  g.rotation.y+=diff*ease;
  // Lock nametag world rotation to 0 (facing from the front/spawn of the room toward the TV)
  if(nametagMeshRef.current){
   nametagMeshRef.current.rotation.y=-g.rotation.y;
  }

  const nextAct=member.action||'idle';
  if(avatarRef.current&&currentActionRef.current!==nextAct){
   currentActionRef.current=nextAct;
   avatarRef.current.setAction(nextAct);
  }
  avatarRef.current?.update(dt);
 });

 return (
  <group ref={groupRef} position={[member.x??0,member.y??0,member.z??1.6]} rotation={[0,member.yaw??Math.PI,0]}>
   {badgeTexture&&(
    <mesh ref={nametagMeshRef} position={[0,1.88,0]} rotation={[0,-(member.yaw??Math.PI),0]} renderOrder={12}>
     <planeGeometry args={[1.55,0.34]}/>
     <meshBasicMaterial map={badgeTexture.tex} transparent={true} depthWrite={false} toneMapped={false} side={THREE.DoubleSide}/>
    </mesh>
   )}
  </group>
 );
}

function playTvChime(){
 if(typeof window==='undefined')return;
 try{
  const AudioCtx=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
  if(!AudioCtx)return;
  const ctx=new AudioCtx();
  const freqs=[523.25, 659.25, 783.99, 1046.50];
  freqs.forEach((f,i)=>{
   const osc=ctx.createOscillator();const g=ctx.createGain();
   osc.type='sine';osc.frequency.setValueAtTime(f,ctx.currentTime+i*0.1);
   g.gain.setValueAtTime(0.001,ctx.currentTime+i*0.1);
   g.gain.exponentialRampToValueAtTime(0.08,ctx.currentTime+i*0.1+0.02);
   g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+i*0.1+0.45);
   osc.connect(g);g.connect(ctx.destination);
   osc.start(ctx.currentTime+i*0.1);osc.stop(ctx.currentTime+i*0.1+0.5);
  });
 }catch{}
}
export default function GameWorld({avatarId,roomSizeMode,controls,onStatus,onAction,eventSink,tvOverlayRefs,tvMedia,playerName,playerRole,playerMuted,playerAudioLevel,remoteMembers,onLocalPose}:GameWorldProps){
 const {camera,gl,scene}=useThree();
 const [w,,d]=ROOM.roomSize;
 const visualScale=ROOM_SIZES[roomSizeMode].scale;
 const root=useRef<THREE.Group>(null!);
 const localNametagRef=useRef<THREE.Mesh>(null!);
 const placeholder=useRef<THREE.Group>(null!);
 const tvScreenMeshRef=useRef<THREE.Mesh>(null!);
 const avatar=useRef<AvatarRuntime|null>(null);
 const ready=useRef(false);
 const seat=useRef(makeSeatRuntime());
 const initialized=useRef(false);
 const focus=useRef(new THREE.Vector3(0,1.18,ROOM.spawn[2]));
 const lastStatus=useRef(0),lastPublish=useRef(0),frames=useRef({counter:0,elapsed:0,fps:0});
 const callbacks=useRef({onStatus,onAction,onLocalPose});callbacks.current={onStatus,onAction,onLocalPose};
 const mediaRef=useRef(tvMedia);mediaRef.current=tvMedia;
 const sink=useRef(eventSink??localGameSink);sink.current=eventSink??localGameSink;
 const target=new THREE.Vector3(),desired=new THREE.Vector3(),tvCamPos=new THREE.Vector3();
 const tvImageRef=useRef<HTMLImageElement|null>(null);
 const tvState=useRef({playing:true,time:0,lastDraw:0});
 const localBadgeTexture=useMemo(()=>{
  if(typeof document==='undefined')return null;
  const c=document.createElement('canvas');
  c.width=512;c.height=112;
  const tex=new THREE.CanvasTexture(c);
  tex.colorSpace=THREE.SRGBColorSpace;
  return {canvas:c,tex};
 },[]);
 useEffect(()=>{
  if(!localBadgeTexture)return;
  drawNametagCanvas(localBadgeTexture.canvas,playerName||'Khách',playerRole,playerMuted??true,playerAudioLevel??0);
  localBadgeTexture.tex.needsUpdate=true;
 },[localBadgeTexture,playerName,playerRole,playerMuted,playerAudioLevel]);
 useEffect(()=>()=>{localBadgeTexture?.tex.dispose();},[localBadgeTexture]);
 const tvCanvas=useMemo(()=>{
  if(typeof document==='undefined')return null;
  const c=document.createElement('canvas');c.width=960;c.height=540;
  const ctx=c.getContext('2d');if(ctx){
   ctx.fillStyle='#7f70b6';ctx.fillRect(0,0,960,540);
   ctx.fillStyle='#fff4e8';ctx.textAlign='center';ctx.font='bold 76px sans-serif';ctx.fillText('♫ Music Box',480,240);
   ctx.font='bold 46px sans-serif';ctx.fillText('Online',480,305);
  }
  return c;
 },[]);
 const tvTexture=useMemo(()=>{
  if(!tvCanvas)return null;
  const tex=new THREE.CanvasTexture(tvCanvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
 },[tvCanvas]);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{tvImageRef.current=img;};
  img.onerror=()=>{
   const fallback=new Image();
   fallback.crossOrigin='anonymous';
   fallback.onload=()=>{tvImageRef.current=fallback;};
   fallback.src=ROOM_TV_IMAGE_URL;
  };
  img.src=tvMedia?.videoId?`https://i.ytimg.com/vi/${tvMedia.videoId}/hqdefault.jpg`:ROOM_TV_IMAGE_URL;
  return ()=>{img.onload=null;img.onerror=null;};
 },[tvMedia?.videoId]);
 useEffect(()=>()=>{tvTexture?.dispose();},[tvTexture]);
 useEffect(()=>{
  resetCamera(controls.current,6.2,.15);
  controls.current.cameraYaw=0.0;
  controls.current.keys.clear();controls.current.joystick={x:0,y:0};controls.current.commands=[];
  controls.current.runHeld=false;
  camera.position.set(0,2.8*visualScale,(ROOM.spawn[2]+6.2)*visualScale);
  initialized.current=false;seat.current=makeSeatRuntime();
  root.current.position.set(ROOM.spawn[0],0,ROOM.spawn[2]);
  root.current.rotation.set(0,Math.PI,0);
  focus.current.set(ROOM.spawn[0],1.58,ROOM.spawn[2]);
 },[camera,controls,roomSizeMode,visualScale]);
 useEffect(()=>{
  let cancelled=false;
  ready.current=false;
  if(placeholder.current)placeholder.current.visible=true;
  const character=findCharacter(avatarId),host=root.current;
  void ChibiAvatar.load(character).then((obj:AvatarRuntime)=>{
   if(cancelled){obj.dispose();return;}
   if(avatar.current){host.remove(avatar.current.root);avatar.current.dispose();}
   avatar.current=obj;host.add(obj.root);
   obj.setAction(seat.current.phase==='sitting'?'sit':'idle');
   ready.current=true;if(placeholder.current)placeholder.current.visible=false;
  }).catch((e:unknown)=>{if(!cancelled){callbacks.current.onAction({type:'notice',message:'Không nạp được GLB nhân vật: '+String(e)});ready.current=false;}});
  return ()=>{cancelled=true;if(avatar.current){host.remove(avatar.current.root);avatar.current.dispose();avatar.current=null;}};
 },[avatarId]);
 useEffect(()=>{
  const canvas=gl.domElement,pointers=new Map<number,{x:number;y:number}>();let pinch:number|null=null;
  const down=(e:PointerEvent)=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});pinch=null;};
  const move=(e:PointerEvent)=>{
   const prev=pointers.get(e.pointerId);if(!prev)return;
   pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pointers.size===1){controls.current.orbitDelta.dx+=e.clientX-prev.x;controls.current.orbitDelta.dy+=e.clientY-prev.y;}
   if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch!==null)controls.current.zoomFactor*=pinch/Math.max(1,d);pinch=d;}
  };
  const up=(e:PointerEvent)=>{pointers.delete(e.pointerId);pinch=null;};
  const wheel=(e:WheelEvent)=>{e.preventDefault();controls.current.zoomFactor*=Math.exp(e.deltaY*.0014);};
  const context=(e:MouseEvent)=>e.preventDefault();
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
  canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);
  canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('contextmenu',context);
  return ()=>{canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('contextmenu',context);};
 },[gl,controls]);
 const report=(message:string)=>callbacks.current.onAction({type:'notice',message});
 const interact=()=>{
  const rt=seat.current,g=root.current;
  if(rt.phase==='sitting'){startStanding(rt,getPose(g));avatar.current?.setAction('idle');report('Đang đứng dậy.');return;}
  if(rt.phase!=='idle')return;
  const hit=nearestInteraction({x:g.position.x,z:g.position.z},ROOM_SIZES[roomSizeMode].capacity);
  if(!hit){report('Hãy đi gần ghế, TV hoặc dùng Bảng điều khiển âm thanh bên phải.');return;}
  sink.current.publish({type:'interaction',id:hit.id,kind:hit.kind==='seat'?'sofa':hit.kind});
  if(hit.kind==='seat'){
   const anchor=ROOM.seatAnchors[hit.index];
   if(startSitting(rt,anchor,getPose(g)))report('Đang tới vị trí ngồi '+anchor.seatId+'…');
  }else if(hit.kind==='tv'){
   toggleTv();
  }else report('Đây là tranh cửa in trên tường, không phải cửa mở được.');
 };
 const toggleTv=()=>{
  tvState.current.playing=!tvState.current.playing;
  playTvChime();
  if(tvCanvas)callbacks.current.onAction({type:'tv',source:tvCanvas});
 };
 useFrame((state,rawDt)=>{
  const dt=Math.min(.05,rawDt),ctl=controls.current,g=root.current,rt=seat.current;
  if(!g)return;
  for(const cmd of ctl.commands.splice(0)){
   if(cmd.type==='interact')interact();
   else if(cmd.type==='stand'){if(rt.phase==='sitting'){startStanding(rt,getPose(g));avatar.current?.setAction('idle');}}
   else if(cmd.type==='jump'){if(rt.phase==='sitting'){startStanding(rt,getPose(g));avatar.current?.setAction('idle');}else if(rt.phase==='idle')avatar.current?.setAction('jump',{duration:.8});}
   else if(cmd.type==='reset'){
    Object.assign(rt,makeSeatRuntime());g.position.set(ROOM.spawn[0],0,ROOM.spawn[2]);g.rotation.y=Math.PI;
    avatar.current?.setAction('idle');report('Đã về vị trí xuất hiện.');
   }
   else if(cmd.type==='camera-reset')resetCamera(ctl,5.2,.2);
   else if(cmd.type==='camera-toggle'){
    ctl.cameraMode=ctl.cameraMode==='follow'?'first-person':ctl.cameraMode==='first-person'?'overview':'follow';
   }
   else if(cmd.type==='camera-mode'&&cmd.mode){
    ctl.cameraMode=cmd.mode;
   }
   else if(cmd.type==='focus-tv'){
    toggleTv();
   }
   else if(cmd.type==='wave'&&rt.phase==='idle')avatar.current?.setAction('wave',{duration:1.6});
   else if(cmd.type==='dance'&&rt.phase==='idle')avatar.current?.setAction('dance',{duration:3});
  }
  const input=combinedInput(ctl.keys,ctl.joystick);
  if(rt.phase==='sitting' && input.strength>.01){startStanding(rt,getPose(g));avatar.current?.setAction('idle');}
  if(rt.phase!=='idle'){
   const before=rt.phase;
   const pose=updateSeat(rt,getPose(g),dt);
   g.position.set(pose.x,pose.y,pose.z);g.rotation.y=pose.yaw;
   if(before!=='sittingDown'&&rt.phase==='sittingDown')avatar.current?.setAction('sit');
   if(before==='standingUp'&&!rt.seat)avatar.current?.setAction('idle');
  }else if(input.strength>.01){
   const dir=cameraRelative(input,ctl.cameraYaw);
   const run=ctl.runHeld||ctl.keys.has('ShiftLeft')||ctl.keys.has('ShiftRight');
   const speed=(run?RUN_SPEED:WALK_SPEED)*input.strength;
   const next=resolveMovement({x:g.position.x,z:g.position.z},{x:dir.x*speed,z:dir.z*speed},dt);
   const moved=Math.hypot(next.x-g.position.x,next.z-g.position.z);
   g.position.x=next.x;g.position.z=next.z;
   if(moved>.0001){
    const yaw=Math.atan2(dir.x,dir.z);
    const diff=Math.atan2(Math.sin(yaw-g.rotation.y),Math.cos(yaw-g.rotation.y));
    g.rotation.y+=diff*(1-Math.exp(-14*dt));avatar.current?.setAction(run?'run':'walk');
   }else if(avatar.current&&['walk','run'].includes(avatar.current.state))avatar.current.setAction('idle');
  }else if(avatar.current&&['walk','run'].includes(avatar.current.state))avatar.current.setAction('idle');
  avatar.current?.update(dt);
  const isFirstPerson=ctl.cameraMode==='first-person';
  if(avatar.current?.root)avatar.current.root.visible=!isFirstPerson;
  if(placeholder.current)placeholder.current.visible=!isFirstPerson&&!ready.current;
  if(localNametagRef.current){
   localNametagRef.current.visible=!isFirstPerson;
   localNametagRef.current.rotation.y=-g.rotation.y;
  }
  ctl.cameraYaw-=ctl.orbitDelta.dx*.0046;
  ctl.cameraElevation=clamp(ctl.cameraElevation+ctl.orbitDelta.dy*.0035,-.8,1.18);
  ctl.cameraDistance=clamp(ctl.cameraDistance*ctl.zoomFactor,2.6,19);
  ctl.orbitDelta.dx=0;ctl.orbitDelta.dy=0;ctl.zoomFactor=1;
  if(isFirstPerson){
   const eyeHeight=rt.phase==='sitting'?1.06:1.38;
   const pitch=clamp(-ctl.cameraElevation,-0.75,0.75);
   const lookDist=8;
   desired.set(g.position.x,g.position.y+eyeHeight,g.position.z).multiplyScalar(visualScale);
   target.set(
    desired.x-Math.sin(ctl.cameraYaw)*Math.cos(pitch)*lookDist,
    desired.y+Math.sin(pitch)*lookDist,
    desired.z-Math.cos(ctl.cameraYaw)*Math.cos(pitch)*lookDist
   );
   if(rt.phase==='idle'&&input.strength<=.01){
    g.rotation.y=ctl.cameraYaw+Math.PI;
   }
   const fpEase=1-Math.exp(-22*dt);
   if(!initialized.current){camera.position.copy(desired);focus.current.copy(target);initialized.current=true;}
   else{camera.position.lerp(desired,fpEase);focus.current.lerp(target,fpEase);}
  }else{
   if(ctl.cameraMode==='overview')target.set(0,1.55,0);
   else target.set(g.position.x,rt.phase==='sitting'?1.38:1.58,g.position.z);
   const e=ctl.cameraMode==='overview'?Math.max(.76,ctl.cameraElevation):ctl.cameraElevation;
   const distance=ctl.cameraMode==='overview'?Math.max(w,d)*.90:ctl.cameraDistance;
   desired.set(target.x+Math.sin(ctl.cameraYaw)*Math.cos(e)*distance,target.y+Math.sin(e)*distance,
               target.z+Math.cos(ctl.cameraYaw)*Math.cos(e)*distance);
   target.multiplyScalar(visualScale);desired.multiplyScalar(visualScale);
   constrainCamera(desired,visualScale,target);
   const ease=1-Math.exp(-6.3*dt);
   if(!initialized.current){camera.position.copy(desired);focus.current.copy(target);initialized.current=true;}
   else{camera.position.lerp(desired,ease);focus.current.lerp(target,ease);}
  }
  constrainCamera(camera.position,visualScale);
  camera.lookAt(focus.current.x, focus.current.y, focus.current.z);

  // Hide front-wall protruding TV/speaker models when camera is on the TV side looking back toward the player
  const lookingFromTvToPlayer = camera.position.z < focus.current.z - 0.35 * visualScale && camera.position.z < -0.5 * visualScale;
  const frontProtrusions = scene.getObjectByName('front_wall_protrusions');
  if (frontProtrusions) frontProtrusions.visible = !lookingFromTvToPlayer;
  const frontStars = scene.getObjectByName('front_wall_arch_stars');
  if (frontStars) frontStars.visible = !lookingFromTvToPlayer;
  if (tvScreenMeshRef.current) tvScreenMeshRef.current.visible = !lookingFromTvToPlayer;

  // Project CSS3D YouTube IFrame onto the exact 3D TV plane in true 3D perspective (K-scaled for 1:1 HD crispness)
  if(tvOverlayRefs?.stage.current&&tvOverlayRefs.camera.current&&tvOverlayRefs.screen.current){
   camera.updateMatrixWorld();
   camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
   const wx=ROOM.tv.screenCenter[0]*visualScale;
   const wy=ROOM.tv.screenCenter[1]*visualScale;
   const wz=(ROOM.tv.screenCenter[2]+0.015)*visualScale;
   tvCamPos.set(wx,wy,wz).applyMatrix4(camera.matrixWorldInverse);
   const screenEl=tvOverlayRefs.screen.current;
   if(!lookingFromTvToPlayer&&tvCamPos.z<-0.8&&camera.position.z>wz+0.6){
    const pCam=camera as THREE.PerspectiveCamera;
    const W=state.size.width, H=state.size.height;
    const fovPx=(0.5/Math.tan(THREE.MathUtils.degToRad(pCam.fov*0.5)))*H;
    const K=960/(ROOM.tv.screenWidth*visualScale);
    const sy=(ROOM.tv.screenHeight*visualScale*K)/540;
    const stageEl=tvOverlayRefs.stage.current;
    const cameraEl=tvOverlayRefs.camera.current;
    stageEl.style.perspective=`${fovPx}px`;
    const m=pCam.matrixWorldInverse.elements;
    const camMatrix=`matrix3d(${eps(m[0])},${eps(-m[1])},${eps(m[2])},${eps(m[3])},${eps(m[4])},${eps(-m[5])},${eps(m[6])},${eps(m[7])},${eps(m[8])},${eps(-m[9])},${eps(m[10])},${eps(m[11])},${eps(m[12]*K)},${eps(-m[13]*K)},${eps(m[14]*K)},${eps(m[15])})`;
    cameraEl.style.width=`${W}px`;
    cameraEl.style.height=`${H}px`;
    cameraEl.style.transform=`translateZ(${fovPx}px) ${camMatrix} translate(${W/2}px,${H/2}px)`;
    screenEl.style.display='block';
    screenEl.style.transform=`translate(-50%,-50%) matrix3d(1,0,0,0,0,${-sy},0,0,0,0,1,0,${wx*K},${wy*K},${wz*K},1)`;
   }else{
    screenEl.style.display='none';
   }
  }

  // Live TV video screen update on 3D mesh (underneath/fallback canvas)
  if(tvCanvas&&tvTexture&&tvImageRef.current){
   const t=state.clock.elapsedTime;
   if(t-tvState.current.lastDraw>0.06){
    tvState.current.lastDraw=t;
    const ctx=tvCanvas.getContext('2d');
    if(ctx){
     const mInfo=mediaRef.current;
     const isPlaying=mInfo?mInfo.playing:tvState.current.playing;
     ctx.drawImage(tvImageRef.current,0,0,960,540);
     if(isPlaying){
      tvState.current.time+=0.06;
      const curT=tvState.current.time;
      const barCount=14, startX=340, barW=16, gap=6, baseY=405;
      for(let b=0;b<barCount;b++){
       const h=6+Math.abs(Math.sin(curT*4.2+b*0.7))*32+Math.abs(Math.cos(curT*2.6+b*1.1))*16;
       const grad=ctx.createLinearGradient(0,baseY-h,0,baseY);
       grad.addColorStop(0,'#ffe58f');grad.addColorStop(1,'#ff7ea5');
       ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(startX+b*(barW+gap),baseY-h,barW,h,3);ctx.fill();
      }
      ctx.fillStyle='#1c162bdd';ctx.fillRect(0,476,960,64);
      ctx.fillStyle='#ffffff';
      ctx.beginPath();ctx.moveTo(32,498);ctx.lineTo(46,510);ctx.lineTo(32,522);ctx.closePath();ctx.fill();
      const totalSec=Math.max(1,mInfo?.duration||210), curSec=Math.floor(mInfo?.currentTime??(curT*2)%totalSec);
      const ratio=Math.min(1,Math.max(0,curSec/totalSec)), barLen=690;
      ctx.fillStyle='#ffffff33';ctx.beginPath();ctx.roundRect(65,507,barLen,6,3);ctx.fill();
      ctx.fillStyle='#ff7ea5';ctx.beginPath();ctx.roundRect(65,507,barLen*ratio,6,3);ctx.fill();
      ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(65+barLen*ratio,510,6,0,Math.PI*2);ctx.fill();
      const m1=Math.floor(curSec/60).toString().padStart(2,'0'), s1=(curSec%60).toString().padStart(2,'0');
      const m2=Math.floor(totalSec/60).toString().padStart(2,'0'), s2=Math.floor(totalSec%60).toString().padStart(2,'0');
      ctx.font='bold 13px sans-serif';ctx.fillStyle='#ffffffdd';ctx.textAlign='left';
      ctx.fillText(`${m1}:${s1} / ${m2}:${s2}`,775,514);
      ctx.fillStyle='#e6005c';ctx.beginPath();ctx.arc(38,36,6,0,Math.PI*2);ctx.fill();
      ctx.font='bold 15px sans-serif';ctx.fillStyle='#ffffff';ctx.textAlign='left';
      ctx.fillText(mInfo?.title?`♫ ${mInfo.title.slice(0,48)}`:'LIVE STREAMING',54,41);
     }else{
      ctx.fillStyle='#1c162bdd';ctx.fillRect(0,476,960,64);
      ctx.fillStyle='#ff7ea5';
      ctx.beginPath();ctx.arc(480,250,44,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ffffff';
      ctx.beginPath();ctx.moveTo(468,230);ctx.lineTo(502,250);ctx.lineTo(468,270);ctx.closePath();ctx.fill();
      ctx.fillStyle='#1c162bcc';ctx.beginPath();ctx.roundRect(220,312,520,42,10);ctx.fill();
      ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.font='bold 20px sans-serif';
      ctx.fillText(mInfo?.title?`♫ ${mInfo.title.slice(0,42)}`:'♫ Music Box Online TV',480,339);
      ctx.font='bold 14px sans-serif';ctx.fillStyle='#ffffffdd';ctx.textAlign='left';
      ctx.fillText('⏸ Sẵn sàng phát — Bấm [▶ Phát] ở bảng bên phải',36,514);
     }
     tvTexture.needsUpdate=true;
    }
   }
  }
  const perf=frames.current;perf.counter++;perf.elapsed+=rawDt;
  if(perf.elapsed>1){perf.fps=Math.round(perf.counter/perf.elapsed);perf.counter=0;perf.elapsed=0;}
  if(state.clock.elapsedTime-lastStatus.current>.25){
   lastStatus.current=state.clock.elapsedTime;
   callbacks.current.onStatus({x:g.position.x,z:g.position.z,fps:perf.fps,action:rt.phase==='sitting'?'sit':avatar.current?.state??'idle',
     seated:rt.phase==='sitting',near:nearestInteraction({x:g.position.x,z:g.position.z},ROOM_SIZES[roomSizeMode].capacity),avatarReady:ready.current,seatPhase:rt.phase});
  }
  if(state.clock.elapsedTime-lastPublish.current>.14&&ready.current){
   lastPublish.current=state.clock.elapsedTime;
   const curAction=rt.phase==='sitting'?'sit':avatar.current?.state??'idle';
   callbacks.current.onLocalPose?.({
    x:g.position.x,
    y:g.position.y,
    z:g.position.z,
    yaw:g.rotation.y,
    action:curAction,
    seated:rt.phase==='sitting',
   });
   const action=curAction as AvatarAction;
   if(['idle','walk','run','sit'].includes(action))sink.current.publish({type:'player.moved',x:g.position.x,z:g.position.z,yaw:g.rotation.y,action});
  }
 });
 return <>
  <color attach="background" args={['#dfd2d6']}/>
  <hemisphereLight args={['#fff6ec','#b8a2b2',0.85]}/>
  <directionalLight color="#fff0df" intensity={0.88} position={[-5,9,7]}/>
  <directionalLight color="#d8c8ec" intensity={0.35} position={[7,7,-1]}/>
  <pointLight color="#ffc4d6" intensity={3.2} distance={15} position={[-4,4,-3]}/>
  <pointLight color="#ffecd2" intensity={4.0} distance={18} position={[0,4.8,-0.5]}/>
  <group scale={visualScale}><RoomLoader/><RoomWallTextures/><RoomFinishes/>
  {tvTexture&&<mesh ref={tvScreenMeshRef} position={[ROOM.tv.screenCenter[0],ROOM.tv.screenCenter[1],ROOM.tv.screenCenter[2]+0.015]} renderOrder={tvMedia?.playing?10:0}>
   <planeGeometry args={[ROOM.tv.screenWidth,ROOM.tv.screenHeight]}/>
   {tvMedia?.playing?(
    <meshBasicMaterial
     color="#000000"
     transparent={true}
     opacity={1}
     blending={THREE.CustomBlending}
     blendEquation={THREE.AddEquation}
     blendSrc={THREE.ZeroFactor}
     blendDst={THREE.ZeroFactor}
     depthTest={true}
     depthWrite={false}
    />
   ):(
    <meshBasicMaterial map={tvTexture} toneMapped={false}/>
   )}
  </mesh>}
  {/* Remote Players in the same room */}
  {remoteMembers?.map(m=><RemoteAvatarActor key={m.id} member={m}/>)}
  <group ref={root} position={ROOM.spawn as [number,number,number]} rotation={[0,Math.PI,0]}>
   {localBadgeTexture&&(
    <mesh ref={localNametagRef} position={[0,1.88,0]} rotation={[0,-Math.PI,0]} renderOrder={12}>
     <planeGeometry args={[1.55,0.34]}/>
     <meshBasicMaterial map={localBadgeTexture.tex} transparent={true} depthWrite={false} toneMapped={false} side={THREE.DoubleSide}/>
    </mesh>
   )}
   <group ref={placeholder}>
    <mesh position={[0,1.23,0]}><sphereGeometry args={[.46,16,12]}/><meshStandardMaterial color="#f8dac5"/></mesh>
    <mesh position={[0,.65,0]}><capsuleGeometry args={[.25,.34,4,12]}/><meshStandardMaterial color="#f4c3d8"/></mesh>
   </group>
  </group></group>
 </>;
}
