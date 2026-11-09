import type {SeatAnchor} from '../data/room';
export type SeatPhase='idle'|'approaching'|'turning'|'sittingDown'|'sitting'|'standingUp';
export type SeatPose={x:number;y:number;z:number;yaw:number};
export interface SeatRuntime {
 phase:SeatPhase;seat:SeatAnchor|null;phaseElapsed:number;start:SeatPose;initial:SeatPose;
}
export const makeSeatRuntime=():SeatRuntime=>({phase:'idle',seat:null,phaseElapsed:0,start:{x:0,y:0,z:0,yaw:0},initial:{x:0,y:0,z:0,yaw:0}});
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(t:number)=>{const q=Math.max(0,Math.min(1,t));return q*q*(3-2*q);};
export const angleDiff=(to:number,from:number)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
export function seatForward(seat:SeatAnchor):number {
 // Normalize from seat backrest toward seat front; never use a global fixed yaw.
 const dx=seat.seatPosition[0]-seat.backrestPosition[0],dz=seat.seatPosition[2]-seat.backrestPosition[2];
 return Math.atan2(dx,dz);
}
export function startSitting(rt:SeatRuntime,seat:SeatAnchor,pose:SeatPose):boolean{
 if(rt.phase!=='idle'||seat.isOccupied)return false;
 rt.seat=seat;rt.start={...pose};rt.initial={...pose};rt.phase='approaching';rt.phaseElapsed=0;
 return true;
}
export function startStanding(rt:SeatRuntime,pose:SeatPose):boolean {
 if(!rt.seat || rt.phase!=='sitting')return false;
 rt.phase='standingUp';rt.phaseElapsed=0;rt.start={...pose};return true;
}
function enter(rt:SeatRuntime,phase:SeatPhase,pose:SeatPose){rt.phase=phase;rt.phaseElapsed=0;rt.start={...pose};}
/** One deterministic animation step. Scene and backend independent. */
export function updateSeat(rt:SeatRuntime,pose:SeatPose,dt:number):SeatPose {
 if(rt.phase==='idle'||!rt.seat)return pose;
 rt.phaseElapsed+=Math.max(0,Math.min(dt,.05));
 const seat=rt.seat;
 const targetYaw=seatForward(seat);
 let target:SeatPose={...pose};
 if(rt.phase==='approaching'){
  const ap=seat.approachPosition;
  const dx=ap[0]-pose.x,dz=ap[2]-pose.z;
  const d=Math.hypot(dx,dz),maxStep=dt*2.3;
  const s=d>maxStep?maxStep/(d||1):1;
  target={...pose,x:pose.x+dx*s,z:pose.z+dz*s,y:0};
  if(d<.04)enter(rt,'turning',target);
 }else if(rt.phase==='turning'){
  const diff=angleDiff(targetYaw,pose.yaw),step=1-Math.exp(-12*dt);
  target={...pose,yaw:pose.yaw+diff*step};
  if(Math.abs(diff)<.024 || rt.phaseElapsed>.45){target.yaw=targetYaw;enter(rt,'sittingDown',target);}
 }else if(rt.phase==='sittingDown'){
  const v=smooth(rt.phaseElapsed/.62),start=rt.start;
  // In the seated rig the bottom of the body is about 0.12 m above its root.
  const rootY=seat.seatHeight-.12;
  target={x:mix(start.x,seat.seatPosition[0],v),y:mix(start.y,rootY,v),z:mix(start.z,seat.seatPosition[2],v),yaw:targetYaw};
  if(v>=1)enter(rt,'sitting',target);
 }else if(rt.phase==='sitting'){
  target={x:seat.seatPosition[0],y:seat.seatHeight-.12,z:seat.seatPosition[2],yaw:targetYaw};
 }else if(rt.phase==='standingUp'){
  const v=smooth(rt.phaseElapsed/.56),start=rt.start,ap=seat.approachPosition;
  target={x:mix(start.x,ap[0],v),y:mix(start.y,0,v),z:mix(start.z,ap[2],v),yaw:targetYaw};
  if(v>=1){rt.seat=null;enter(rt,'idle',target);}
 }
 return target;
}
