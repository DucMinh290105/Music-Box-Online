import manifestJson from './roomManifest.json';
export interface WorldPoint {x:number;z:number}
export interface SeatAnchor {
 seatId:string;kind:'sofa'|'ottoman'|'piano';seatPosition:number[];seatRotation:number;
 seatHeight:number;backrestPosition:number[];approachPosition:number[];sitAnimation:string;
 occupantId:string|null;isOccupied:boolean;parent:string;
}
export interface AssetInstance {
 id:string;asset:string;category:string;position:number[];rotationY:number;scale:number[];
 collider?:null|{type?:string;kind?:string;width?:number;depth?:number;radius?:number;size?:number[]};
 interaction?:null|{kind:string;position:number[];radius:number};
}
export const ROOM = manifestJson as unknown as {
 units:string;roomSize:number[];spawn:number[];seatAnchors:SeatAnchor[];assetInstances:AssetInstance[];
 tv:{screenCenter:number[];screenWidth:number;screenHeight:number;forward:number[];interactionPosition:number[]};
 door:{position:number[];type:string};
};
export const SEAT_ANCHORS=ROOM.seatAnchors;
export const ROOM_MODEL_URL='/models/room/music_box_room_optimized.glb';
export const ROOM_TV_IMAGE_URL='/models/room/tv_preview.png';
