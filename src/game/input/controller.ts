import type {Stick} from '../core/movement.ts';
export type CameraMode='follow'|'overview';
export type GameCommand={type:'interact'|'stand'|'reset'|'camera-reset'|'camera-toggle'|'focus-tv'|'wave'|'dance'|'jump'};
export interface Controls {
 keys:Set<string>;joystick:Stick;runHeld:boolean;
 cameraYaw:number;cameraElevation:number;cameraDistance:number;cameraMode:CameraMode;
 orbitDelta:{dx:number;dy:number};zoomFactor:number;commands:GameCommand[];
}
export function createControls():Controls{
 return {keys:new Set(),joystick:{x:0,y:0},runHeld:false,cameraYaw:.02,cameraElevation:.2,cameraDistance:5.2,
 cameraMode:'follow',orbitDelta:{dx:0,dy:0},zoomFactor:1,commands:[]};
}
export function resetCamera(c:Controls,distance=5.2,elevation=.2){
 c.cameraYaw=.02;c.cameraElevation=elevation;c.cameraDistance=distance;c.cameraMode='follow';
 c.orbitDelta={dx:0,dy:0};c.zoomFactor=1;
}
