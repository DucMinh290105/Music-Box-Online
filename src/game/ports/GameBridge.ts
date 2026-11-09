/** Interface boundary for future networking, video and voice. No backend is connected in Phase 1 & 2. */
export type AvatarAction='idle'|'walk'|'run'|'sit';
export type GameEvent =
 | {type:'player.moved';x:number;z:number;yaw:number;action:AvatarAction}
 | {type:'interaction';id:string;kind:'sofa'|'tv'|'door'};
export interface GameEventSink { publish(event:GameEvent):void }
export const localGameSink:GameEventSink={publish:()=>{ /* local prototype, intentional no-op */ }};
export interface FutureNetworkAdapter extends GameEventSink {connect(roomId:string):Promise<void>;disconnect():Promise<void>}
export interface FuturePlaybackAdapter {mount(container:HTMLElement):void;unmount():void}
