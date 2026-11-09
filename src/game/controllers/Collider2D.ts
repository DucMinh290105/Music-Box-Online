/** Pure no-UI 2D physics core, measured in meters, suitable for unit tests and multiplayer. */
export type V2={x:number;z:number};
export interface ColliderBody {id:string;x:number;z:number;rotation:number;halfX:number;halfZ:number;kind:'box'|'circle';radius:number}
export function blockedPoint(x:number,z:number,room:[number,number],colliders:readonly ColliderBody[],radius=.34):string|null{
 const [width,depth]=room,edge=.16;
 if(x< -width/2+edge+radius || x>width/2-edge-radius || z< -depth/2+edge+radius || z>depth/2-edge-radius)return 'room-wall';
 for(const c of colliders){
  const dx=x-c.x,dz=z-c.z;
  if(c.kind==='circle'){
   if(Math.hypot(dx,dz)<c.radius+radius)return c.id;
  }else{
   const cc=Math.cos(c.rotation),ss=Math.sin(c.rotation);
   const lx=cc*dx-ss*dz,lz=ss*dx+cc*dz;
   const nx=Math.max(-c.halfX,Math.min(c.halfX,lx)),nz=Math.max(-c.halfZ,Math.min(c.halfZ,lz));
   if((lx-nx)**2+(lz-nz)**2<radius*radius)return c.id;
  }
 }
 return null;
}
export function slideMove(p:V2,velocity:V2,dt:number,room:[number,number],colliders:readonly ColliderBody[],radius=.34):V2{
 if(!Number.isFinite(dt)||dt<=0)return {...p};
 let x=p.x,z=p.z;const n=Math.max(1,Math.ceil(Math.hypot(velocity.x,velocity.z)*dt/.12));
 for(let k=0;k<n;k++){
  const xx=x+velocity.x*dt/n;if(!blockedPoint(xx,z,room,colliders,radius))x=xx;
  const zz=z+velocity.z*dt/n;if(!blockedPoint(x,zz,room,colliders,radius))z=zz;
 }
 return {x,z};
}
