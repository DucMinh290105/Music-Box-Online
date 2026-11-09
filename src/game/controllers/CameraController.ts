import * as THREE from 'three';
import {ROOM} from '../data/room';
import {clampToRoom,fitCameraToRoom} from './cameraBounds';
export function constrainCamera(point:THREE.Vector3, scale:number, target?:THREE.Vector3):THREE.Vector3 {
 return target?fitCameraToRoom(point,target,ROOM.roomSize,scale,1.55):clampToRoom(point,ROOM.roomSize,scale,1.55);
}
