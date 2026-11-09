/** Visual-size presets. Logical coordinates stay in Friends-room metres.
 * Uniform scaling preserves all collider/seat orientations and aspect ratios.
 * Only one preset is active; multiplayer is intentionally not implemented. */
export type RoomSizeMode='mini'|'friends';
export const ROOM_SIZES={
 mini:{scale:0.71,capacity:10,label:'Music Box Mini',width:18.4*0.71,depth:14.2*0.71},
 friends:{scale:1,capacity:20,label:'Music Box Friends',width:18.4,depth:14.2}
} as const;
