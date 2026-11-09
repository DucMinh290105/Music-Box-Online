import {ROOM,SEAT_ANCHORS} from '../data/room';
import type {V2} from './CollisionManager';
export type Interaction =
 | {kind:'seat';id:string;index:number;label:string;distance:number}
 | {kind:'tv';id:'tv';label:string;distance:number}
 | {kind:'door';id:'door';label:string;distance:number};
const distance=(p:V2,v:number[])=>Math.hypot(p.x-v[0],p.z-v[2]);
export function nearestInteraction(p:V2,seatCapacity=20):Interaction|null{
 const spots:Interaction[]=[];
 SEAT_ANCHORS.forEach((seat,index)=>{
  if(seat.isOccupied||index>=seatCapacity)return;
  const d=distance(p,seat.approachPosition);
  if(d<1.40)spots.push({kind:'seat',id:seat.seatId,index,distance:d,label:seat.kind==='piano'?'Ngồi đàn piano':'Ngồi ghế'});
 });
 const tvDist=distance(p,ROOM.tv.interactionPosition);
 if(tvDist<2.20)spots.push({kind:'tv',id:'tv',distance:tvDist,label:'Xem TV'});
 const doorDist=distance(p,[7.75,0,-2.7]);
 if(doorDist<1.8)spots.push({kind:'door',id:'door',distance:doorDist,label:'Xem tranh cửa'});
 return spots.sort((a,b)=>a.distance-b.distance)[0]??null;
}
