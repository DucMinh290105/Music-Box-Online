import {ROOM_MODEL_URL,ROOM_TV_IMAGE_URL} from '../data/room';
export const ASSETS={room:ROOM_MODEL_URL,tvPreview:ROOM_TV_IMAGE_URL} as const;
export function preloadGameAssets(){
 if(typeof window==='undefined')return;
 // Actual GLB is cached by React Three Fiber useLoader. Preload texture asynchronously.
 const image=new Image();image.src=ASSETS.tvPreview;
}
