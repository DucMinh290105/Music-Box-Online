import {ROOM,type AssetInstance} from '../data/room';
import {AVATAR_RADIUS} from '../core/movement';
import {blockedPoint,slideMove,type ColliderBody,type V2} from './Collider2D';
export type {V2,ColliderBody};
export const COLLIDERS:ColliderBody[]=ROOM.assetInstances.flatMap((obj:AssetInstance)=>{
 const c=obj.collider;
 if(!c||!['box','obb','circle'].includes(c.type??''))return [];
 return [{id:obj.id,x:obj.position[0],z:obj.position[2],rotation:obj.rotationY??0,
  halfX:(c.width??0)/2,halfZ:(c.depth??0)/2,
  kind:c.type==='circle'?'circle' as const:'box' as const,radius:c.radius??0}];
});
const size:[number,number]=[ROOM.roomSize[0],ROOM.roomSize[2]];
export function collisionAt(x:number,z:number,radius=AVATAR_RADIUS){return blockedPoint(x,z,size,COLLIDERS,radius);}
export function resolveMovement(p:V2,velocity:V2,dt:number,radius=AVATAR_RADIUS){return slideMove(p,velocity,dt,size,COLLIDERS,radius);}
