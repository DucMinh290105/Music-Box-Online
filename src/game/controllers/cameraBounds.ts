/** Move along the target-to-camera segment until the camera fits inside the room. */
export function fitCameraToRoom<T extends {x:number;y:number;z:number}>(point:T, target:{x:number;y:number;z:number}, size:readonly number[], scale:number, padding=0.4):T {
 const [width,height,depth]=size, p=padding*scale;
 const min=[-width*scale/2+p,p,-depth*scale/2+p], max=[width*scale/2-p,height*scale-p,depth*scale/2-p];
 const start=[target.x,target.y,target.z], end=[point.x,point.y,point.z];
 let t=1;
 for(let i=0;i<3;i++){
  const delta=end[i]-start[i];
  if(delta>0)t=Math.min(t,(max[i]-start[i])/delta);
  else if(delta<0)t=Math.min(t,(min[i]-start[i])/delta);
 }
 t=Math.max(0,Math.min(1,t));
 point.x=start[0]+(end[0]-start[0])*t;
 point.y=start[1]+(end[1]-start[1])*t;
 point.z=start[2]+(end[2]-start[2])*t;
 return point;
}
export function clampToRoom<T extends {x:number;y:number;z:number}>(point:T, size:readonly number[], scale:number, padding=0.4):T {
 const [w,h,d]=size,p=padding*scale,clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
 point.x=clamp(point.x,-w*scale/2+p,w*scale/2-p);point.y=clamp(point.y,p,h*scale-p);point.z=clamp(point.z,-d*scale/2+p,d*scale/2-p);return point;
}
