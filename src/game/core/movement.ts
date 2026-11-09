/** Local game rules. Three.js / React / backend independent.
 *  1 world unit = 1 meter; right-handed Y-up world with X/Z floor.
 */
export interface Vec2 { x: number; z: number }
export interface Stick { x: number; y: number }
export interface NormalizedStick extends Stick { strength: number }
export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number; name: string }
export interface CollisionRoom { width: number; depth: number; colliders: readonly Collider[] }
export const AVATAR_RADIUS = 0.34;
export const WALK_SPEED = 2.65;
export const RUN_SPEED = 3.85;

export function axisFromKeys(keys: ReadonlySet<string>): Stick {
  return {
    x: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
    y: Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')),
  };
}
export function combinedInput(keys: ReadonlySet<string>, joystick: Stick = {x: 0, y: 0}): NormalizedStick {
  const k = axisFromKeys(keys);
  const x = k.x + (Number.isFinite(joystick.x) ? joystick.x : 0);
  const y = k.y + (Number.isFinite(joystick.y) ? joystick.y : 0);
  const len = Math.hypot(x,y);
  if (len < 0.105) return {x: 0, y: 0, strength: 0};
  return {x: x/len, y: y/len, strength: Math.min(len,1)};
}
/** Camera yaw 0 looks into -Z; W = forward relative to camera. */
export function cameraRelative(input: Stick, yaw: number): Vec2 {
  return {x: Math.cos(yaw)*input.x-Math.sin(yaw)*input.y,
    z: -Math.sin(yaw)*input.x-Math.cos(yaw)*input.y};
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function intersectsRect(x: number, z: number, radius: number, rect: Collider): boolean {
  const cx=clamp(x,rect.minX,rect.maxX), cz=clamp(z,rect.minZ,rect.maxZ);
  return (x-cx)**2+(z-cz)**2 < radius*radius;
}
export function isBlocked(x: number,z: number,room: CollisionRoom,radius=AVATAR_RADIUS): boolean {
  const edge=0.28;
  if(x < -room.width/2+edge+radius || x > room.width/2-edge-radius ||
    z < -room.depth/2+edge+radius || z > room.depth/2-edge-radius) return true;
  return room.colliders.some(rect=>intersectsRect(x,z,radius,rect));
}
export function resolveMove(pos: Vec2, velocity: Vec2, dt: number, room: CollisionRoom,radius=AVATAR_RADIUS): Vec2 {
  if(!Number.isFinite(dt) || dt<=0) return {...pos};
  let {x,z}=pos;
  const count=Math.max(1,Math.ceil(Math.hypot(velocity.x,velocity.z)*dt/0.16));
  for(let i=0;i<count;i++){
    const nx=x+velocity.x*dt/count;
    if(!isBlocked(nx,z,room,radius))x=nx;
    const nz=z+velocity.z*dt/count;
    if(!isBlocked(x,nz,room,radius))z=nz;
  }
  return {x,z};
}
export function makeCollider(x:number,z:number,width:number,depth:number,name='furniture'):Collider {
  return {minX:x-width/2,maxX:x+width/2,minZ:z-depth/2,maxZ:z+depth/2,name};
}
export interface PointerRect {left:number;top:number;width:number;height:number}
export function joystickFromPointer(clientX:number,clientY:number,rect:PointerRect,maxRadius=42) {
  const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  const dx=clientX-cx,dy=clientY-cy,len=Math.hypot(dx,dy);
  const scale=Math.min(1,maxRadius/(len||1));
  return {x:dx*scale/maxRadius,y:-dy*scale/maxRadius,knobX:dx*scale,knobY:dy*scale};
}
