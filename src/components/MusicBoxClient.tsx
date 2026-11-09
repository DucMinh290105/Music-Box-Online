'use client';
import {useCallback,useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import dynamic from 'next/dynamic';
import io,{type Socket} from 'socket.io-client';
import {CHARACTERS} from '@/game/actors/roster';
import {ROOM} from '@/game/data/room';
import {createControls,type Controls,type GameCommand} from '@/game/input/controller';
import {joystickFromPointer} from '@/game/core/movement';
import type {WorldAction,WorldStatus,LocalPlayerPose} from '@/game/GameWorld';
import {preloadGameAssets} from '@/game/assets/AssetManager';
import YouTubePlayer,{type YouTubePlayerHandle} from '@/app/lab/audio-youtube/components/YouTubePlayer';
import {extractYouTubeId} from '@/lib/youtube/urlParser';
import type {RoomState,QueueItem,RoomMember} from '@/lib/types/realtime';

const GameCanvas=dynamic(()=>import('./GameCanvas'),{ssr:false,
 loading:()=> <div className="loading-stage" role="status"><div className="loading-record">♫</div><p>Đang tải phòng Music Box 3D...</p></div>});

function resolveRealtimeUrl():string{
 if(process.env.NEXT_PUBLIC_REALTIME_URL)return process.env.NEXT_PUBLIC_REALTIME_URL;
 if(typeof window==='undefined')return 'http://localhost:3101';
 const {protocol,hostname,port,origin}=window.location;
 // In local/LAN dev where Next.js runs on port 3000, connect to realtime server on port 3101 of the same host
 if(port==='3000')return `${protocol}//${hostname}:3101`;
 // In unified cloud production (Render/Railway/VPS), Socket.IO runs on the exact same origin
 return origin;
}

const RTC_CONFIG:RTCConfiguration={
 iceServers:[
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
 ],
};

const moveKeys=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
const actions:Record<string,string>={idle:'Đứng',walk:'Đi',run:'Chạy',sit:'Ngồi',jump:'Nhảy',wave:'Vẫy tay',dance:'Nhảy múa'};
const initial:WorldStatus={x:ROOM.spawn[0],z:ROOM.spawn[2],fps:0,action:'idle',seated:false,near:null,avatarReady:false,seatPhase:'idle'};

const INITIAL_QUEUE:QueueItem[]=[
 {id:'q-1',videoId:'jfKfPfyJRdk',title:'Lofi Girl - Chill Lofi Hip Hop Radio',addedBy:'Music Box',addedAt:0},
 {id:'q-2',videoId:'bM7SZ5SBzyY',title:'Elektronomia - Sky High [NCS Release]',addedBy:'Music Box',addedAt:0},
 {id:'q-3',videoId:'FlsCjmMhFmw',title:'Alan Walker - Fade [NCS Release]',addedBy:'Music Box',addedAt:0},
];

function formatTime(sec:number){
 if(!Number.isFinite(sec)||sec<0)return '00:00';
 const m=Math.floor(sec/60);
 const s=Math.floor(sec%60);
 return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export default function MusicBoxClient(){
 const [avatarId,setAvatarId]=useState('chibi-01');
 const [status,setStatus]=useState<WorldStatus>(initial);
 const [message,setMessage]=useState('Dùng bảng Âm thanh & TV bên phải để bật nhạc và hát online.');
 const [showHelp,setShowHelp]=useState(false);
 const [panelOpen,setPanelOpen]=useState(true);
 const [audioPanelOpen,setAudioPanelOpen]=useState(true);
 const [activeTab,setActiveTab]=useState<'music'|'voice'>('music');
 const [showJoystick,setShowJoystick]=useState(false);
 const [cameraMode,setCameraMode]=useState<'follow'|'overview'>('follow');
 const control=useRef<Controls>(createControls());
 const stick=useRef<HTMLDivElement>(null);
 const pointer=useRef<number|null>(null);
 const [knob,setKnob]=useState({x:0,y:0});

 // Room & User Identity State (for Shareable Links ?room=...)
 const [roomId,setRoomId]=useState('music-box-20');
 const [roomInput,setRoomInput]=useState('music-box-20');
 const [userName,setUserName]=useState('Khách');
 const [mySocketId,setMySocketId]=useState('');
 const [copyCopied,setCopyCopied]=useState(false);
 const [remoteMovedMap,setRemoteMovedMap]=useState<Record<string,Partial<RoomMember>>>({});

 // CSS3D Overlay Refs for projecting the live YouTube IFrame onto the 3D TV plane
 const cssStageRef=useRef<HTMLDivElement|null>(null);
 const cssCameraRef=useRef<HTMLDivElement|null>(null);
 const cssScreenRef=useRef<HTMLDivElement|null>(null);

 // YouTube & Audio Control State
 const playerRef=useRef<YouTubePlayerHandle|null>(null);
 const socketRef=useRef<Socket|null>(null);
 const [socketConnected,setSocketConnected]=useState(false);
 const [roomState,setRoomState]=useState<RoomState|null>(null);
 const serverTimeOffsetRef=useRef(0);
 const audioDelayRef=useRef(0);
 const lastLocalActionRef=useRef(0);
 const lastAppliedVersionRef=useRef(0);

 const [videoId,setVideoId]=useState('K4DyBUG242c');
 const [videoTitle,setVideoTitle]=useState('Cartoon, Jéja - On & On [NCS]');
 const [isPlaying,setIsPlaying]=useState(false);
 const [currentTime,setCurrentTime]=useState(0);
 const [duration,setDuration]=useState(208);
 const [personalVolume,setPersonalVolume]=useState(80);
 const [isMuted,setIsMuted]=useState(false);
 const [audioDelayMs,setAudioDelayMs]=useState(0);
 const [urlInput,setUrlInput]=useState('');
 const [urlFeedback,setUrlFeedback]=useState<string|null>(null);
 const [localQueue,setLocalQueue]=useState<QueueItem[]>(INITIAL_QUEUE);
 const [localHistory,setLocalHistory]=useState<QueueItem[]>([]);

 // Online Singing (WebRTC Voice + Karaoke Monitor) State
 const [micEnabled,setMicEnabled]=useState(false);
 const [micLevel,setMicLevel]=useState(0);
 const [voiceVolume,setVoiceVolume]=useState(90);
 const [echoMonitor,setEchoMonitor]=useState(false);
 const [voiceNotice,setVoiceNotice]=useState<string|null>(null);

 const localStreamRef=useRef<MediaStream|null>(null);
 const peersRef=useRef<Map<string,RTCPeerConnection>>(new Map());
 const remoteAudioElsRef=useRef<Map<string,HTMLAudioElement>>(new Map());
 const audioCtxRef=useRef<AudioContext|null>(null);
 const monitorGainRef=useRef<GainNode|null>(null);
 const delayGainRef=useRef<GainNode|null>(null);
 const levelTimerRef=useRef<number|null>(null);

 const queueList=roomState?.queue??localQueue;

 // Initialize Room ID from URL (?room=...) and saved user name
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const params=new URLSearchParams(window.location.search);
  const urlRoom=params.get('room')?.trim();
  if(urlRoom){
   setRoomId(urlRoom);
   setRoomInput(urlRoom);
  }
  const savedName=localStorage.getItem('mb_user_name');
  const initialName=savedName||`Ca sĩ ${Math.floor(100+Math.random()*900)}`;
  if(!savedName)localStorage.setItem('mb_user_name',initialName);
  setUserName(initialName);
  const savedAvatar=localStorage.getItem('mb_avatar_id');
  if(savedAvatar)setAvatarId(savedAvatar);
 },[]);

 // Helper: Close a single WebRTC peer connection
 const closePeer=useCallback((peerId:string)=>{
  const pc=peersRef.current.get(peerId);
  if(pc){
   try{pc.close();}catch{}
   peersRef.current.delete(peerId);
  }
  const audioEl=remoteAudioElsRef.current.get(peerId);
  if(audioEl){
   audioEl.srcObject=null;
   audioEl.remove();
   remoteAudioElsRef.current.delete(peerId);
  }
 },[]);

 // Helper: Create or get RTCPeerConnection for a peer in the room
 const getOrCreatePeer=useCallback((peerId:string,initiator:boolean)=>{
  const socket=socketRef.current;
  if(!socket)return null;
  let pc=peersRef.current.get(peerId);
  if(pc)return pc;

  pc=new RTCPeerConnection(RTC_CONFIG);
  peersRef.current.set(peerId,pc);

  if(localStreamRef.current){
   for(const track of localStreamRef.current.getTracks()){
    pc.addTrack(track,localStreamRef.current);
   }
  }

  pc.onicecandidate=(ev)=>{
   if(ev.candidate&&socketRef.current){
    socketRef.current.emit('webrtc:ice-candidate',{toId:peerId,candidate:ev.candidate});
   }
  };

  pc.ontrack=(ev)=>{
   const [remoteStream]=ev.streams;
   if(!remoteStream)return;
   let audioEl=remoteAudioElsRef.current.get(peerId);
   if(!audioEl){
    audioEl=document.createElement('audio');
    audioEl.autoplay=true;
    audioEl.setAttribute('playsinline','true');
    audioEl.style.display='none';
    document.body.appendChild(audioEl);
    remoteAudioElsRef.current.set(peerId,audioEl);
   }
   audioEl.srcObject=remoteStream;
   audioEl.volume=Math.max(0,Math.min(1,voiceVolume/100));
   void audioEl.play().catch(()=>{});
  };

  pc.onconnectionstatechange=()=>{
   if(pc&&['failed','closed','disconnected'].includes(pc.connectionState)){
    if(pc.connectionState==='failed'||pc.connectionState==='closed'){
     closePeer(peerId);
    }
   }
  };

  if(initiator){
   void pc.createOffer()
    .then(offer=>pc!.setLocalDescription(offer).then(()=>offer))
    .then(offer=>{
     socket.emit('webrtc:offer',{toId:peerId,sdp:offer});
    })
    .catch(()=>{});
  }

  return pc;
 },[closePeer,voiceVolume]);

 // Update volume on all active remote voice elements when voiceVolume changes
 useEffect(()=>{
  const vol=Math.max(0,Math.min(1,voiceVolume/100));
  for(const el of remoteAudioElsRef.current.values()){
   el.volume=vol;
  }
 },[voiceVolume]);

 // Update karaoke echo/monitor gain nodes
 useEffect(()=>{
  if(monitorGainRef.current){
   monitorGainRef.current.gain.value=echoMonitor&&micEnabled?0.45:0;
  }
  if(delayGainRef.current){
   delayGainRef.current.gain.value=echoMonitor&&micEnabled?0.28:0;
  }
 },[echoMonitor,micEnabled]);

 // Connect to Realtime Server whenever roomId changes
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const savedName=localStorage.getItem('mb_user_name')||userName||'Khách';
  const savedAvatar=localStorage.getItem('mb_avatar_id')||avatarId;
  const realtimeUrl=resolveRealtimeUrl();

  const socket=io(realtimeUrl,{
   query:{room:roomId,name:savedName,avatarId:savedAvatar},
   transports:['websocket','polling'],
   reconnectionAttempts:10,
  });

  socket.on('connect',()=>{
   setSocketConnected(true);
   setMySocketId(socket.id||'');
   socket.emit('time:ping',{clientSentTime:Date.now()});
   socket.emit('webrtc:ready');
  });

  socket.on('time:pong',({clientSentTime,serverTime}:{clientSentTime:number;serverTime:number})=>{
   const now=Date.now();
   const rtt=now-clientSentTime;
   serverTimeOffsetRef.current=serverTime-(clientSentTime+rtt/2);
  });

  socket.on('room:state',(state:RoomState)=>{
   setRoomState(state);
   const pb=state.playback;
   if(!pb)return;
   if(pb.title)setVideoTitle(pb.title);

   if(Date.now()-lastLocalActionRef.current<3500){
    lastAppliedVersionRef.current=pb.playbackVersion;
    return;
   }

   setVideoId(pb.videoId);
   setIsPlaying(pb.playbackStatus==='playing');

   if(pb.playbackVersion!==lastAppliedVersionRef.current){
    lastAppliedVersionRef.current=pb.playbackVersion;
    const now=Date.now()+serverTimeOffsetRef.current;
    const elapsed=pb.playbackStatus==='playing'?Math.max(0,(now-pb.updatedAt)/1000):0;
    const targetSec=Math.max(0,pb.positionSeconds+elapsed+audioDelayRef.current/1000);
    const cur=playerRef.current?.getCurrentTime?.()||0;
    if(targetSec>1.5&&Math.abs(cur-targetSec)>2.5){
     setCurrentTime(targetSec);
     playerRef.current?.seekTo(targetSec);
    }
   }
  });

  socket.on('player:moved',(data:{id:string;x:number;y:number;z:number;yaw:number;action:string;seated:boolean;avatarId?:string})=>{
   if(!data?.id)return;
   setRemoteMovedMap(prev=>({...prev,[data.id]:data}));
  });

  socket.on('audio:update',(data:{id:string;isMuted:boolean;audioLevel:number})=>{
   if(!data?.id)return;
   setRoomState(prev=>{
    if(!prev)return prev;
    return {
     ...prev,
     members:prev.members.map(m=>m.id===data.id?{...m,isMuted:data.isMuted,audioLevel:data.audioLevel}:m),
    };
   });
  });

  socket.on('room:error',({message:errMsg}:{message:string})=>{
   setVoiceNotice(errMsg);
   setTimeout(()=>setVoiceNotice(null),4000);
  });

  // WebRTC Signaling handlers
  socket.on('webrtc:peer-ready',({fromId}:{fromId:string})=>{
   if(!fromId||fromId===socket.id)return;
   closePeer(fromId);
   getOrCreatePeer(fromId,true);
  });

  socket.on('webrtc:offer',async({fromId,sdp}:{fromId:string;sdp:RTCSessionDescriptionInit})=>{
   if(!fromId||!sdp)return;
   let pc=peersRef.current.get(fromId);
   if(!pc)pc=getOrCreatePeer(fromId,false)??undefined;
   if(!pc)return;
   try{
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer=await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc:answer',{toId:fromId,sdp:answer});
   }catch{}
  });

  socket.on('webrtc:answer',async({fromId,sdp}:{fromId:string;sdp:RTCSessionDescriptionInit})=>{
   const pc=peersRef.current.get(fromId);
   if(!pc||!sdp)return;
   try{
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
   }catch{}
  });

  socket.on('webrtc:ice-candidate',async({fromId,candidate}:{fromId:string;candidate:RTCIceCandidateInit})=>{
   const pc=peersRef.current.get(fromId);
   if(!pc||!candidate)return;
   try{
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
   }catch{}
  });

  socket.on('webrtc:peer-left',({peerId}:{peerId:string})=>{
   if(peerId)closePeer(peerId);
  });

  socket.on('disconnect',()=>{
   setSocketConnected(false);
  });

  socketRef.current=socket;
  return ()=>{
   socket.disconnect();
   socketRef.current=null;
   for(const peerId of Array.from(peersRef.current.keys())){
    closePeer(peerId);
   }
  };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[roomId]);

 // Sync avatar selection changes to room
 const handleChangeAvatar=useCallback((nextAvatar:string)=>{
  setAvatarId(nextAvatar);
  if(typeof window!=='undefined')localStorage.setItem('mb_avatar_id',nextAvatar);
  if(socketRef.current&&socketConnected){
   socketRef.current.emit('member:update',{avatarId:nextAvatar});
  }
 },[socketConnected]);

 // Sync user display name changes to room
 const handleSaveName=useCallback((nextName:string)=>{
  const cleaned=nextName.trim().slice(0,28)||'Ca sĩ';
  setUserName(cleaned);
  if(typeof window!=='undefined')localStorage.setItem('mb_user_name',cleaned);
  if(socketRef.current&&socketConnected){
   socketRef.current.emit('member:update',{name:cleaned});
  }
  setVoiceNotice('✓ Đã cập nhật tên hiển thị!');
  setTimeout(()=>setVoiceNotice(null),2200);
 },[socketConnected]);

 // Switch or create a new room code
 const handleJoinRoom=useCallback((targetRoomRaw?:string)=>{
  const raw=(targetRoomRaw??roomInput).trim().toLowerCase().replace(/[^a-z0-9-_]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,32)||'music-box-20';
  setRoomInput(raw);
  setRoomId(raw);
  setRemoteMovedMap({});
  if(typeof window!=='undefined'){
   const url=new URL(window.location.href);
   url.searchParams.set('room',raw);
   window.history.replaceState({},'',url.toString());
  }
  setVoiceNotice(`✓ Đã chuyển sang phòng: ${raw}`);
  setTimeout(()=>setVoiceNotice(null),2500);
 },[roomInput]);

 // Copy Shareable Room Invite Link
 const handleCopyShareLink=useCallback(()=>{
  if(typeof window==='undefined')return;
  const url=new URL(window.location.href);
  url.searchParams.set('room',roomId);
  const shareUrl=url.toString();
  void navigator.clipboard?.writeText(shareUrl).then(()=>{
   setCopyCopied(true);
   setMessage(`Đã sao chép link mời bạn bè vào phòng "${roomId}"!`);
   setTimeout(()=>setCopyCopied(false),2600);
  }).catch(()=>{
   setCopyCopied(true);
   setTimeout(()=>setCopyCopied(false),2600);
  });
 },[roomId]);

 // Stop microphone and cleanup audio nodes
 const stopMicrophone=useCallback(()=>{
  if(levelTimerRef.current){
   window.clearInterval(levelTimerRef.current);
   levelTimerRef.current=null;
  }
  if(localStreamRef.current){
   for(const t of localStreamRef.current.getTracks())t.stop();
   localStreamRef.current=null;
  }
  if(audioCtxRef.current){
   void audioCtxRef.current.close().catch(()=>{});
   audioCtxRef.current=null;
   monitorGainRef.current=null;
   delayGainRef.current=null;
  }
  setMicEnabled(false);
  setMicLevel(0);
  if(socketRef.current&&socketConnected){
   socketRef.current.emit('audio:state',{isMuted:true,audioLevel:0});
  }
 },[socketConnected]);

 // Toggle Online Singing Microphone
 const handleToggleMic=useCallback(async()=>{
  if(micEnabled){
   stopMicrophone();
   setVoiceNotice('Đã tắt Microphone.');
   setTimeout(()=>setVoiceNotice(null),2000);
   return;
  }

  // Request mic permission in room if not yet granted
  const me=roomState?.members.find(m=>m.id===mySocketId);
  if(me&&!me.canPublishMic&&socketRef.current){
   socketRef.current.emit('role:request_mic');
  }

  try{
   const stream=await navigator.mediaDevices.getUserMedia({
    audio:{
     echoCancellation:true,
     noiseSuppression:true,
     autoGainControl:true,
    },
    video:false,
   });
   localStreamRef.current=stream;
   setMicEnabled(true);
   setVoiceNotice('🎤 Đang phát giọng hát trực tiếp trong phòng!');
   setTimeout(()=>setVoiceNotice(null),3000);

   // Setup Web Audio API Analyser + optional Karaoke Echo Monitor
   const AudioCtx=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
   if(AudioCtx){
    const ctx=new AudioCtx();
    audioCtxRef.current=ctx;
    const source=ctx.createMediaStreamSource(stream);
    const analyser=ctx.createAnalyser();
    analyser.fftSize=256;
    source.connect(analyser);

    // Subtle karaoke echo monitor (only active when user enables `echoMonitor`)
    const monitorGain=ctx.createGain();
    monitorGain.gain.value=echoMonitor?0.45:0;
    const delayNode=ctx.createDelay(0.5);
    delayNode.delayTime.value=0.14;
    const feedbackGain=ctx.createGain();
    feedbackGain.gain.value=0.25;
    const delayOutGain=ctx.createGain();
    delayOutGain.gain.value=echoMonitor?0.28:0;

    source.connect(monitorGain);
    monitorGain.connect(ctx.destination);

    source.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(delayNode);
    delayNode.connect(delayOutGain);
    delayOutGain.connect(ctx.destination);

    monitorGainRef.current=monitorGain;
    delayGainRef.current=delayOutGain;

    const dataArr=new Uint8Array(analyser.frequencyBinCount);
    levelTimerRef.current=window.setInterval(()=>{
     analyser.getByteFrequencyData(dataArr);
     let sum=0;
     for(let i=0;i<dataArr.length;i++)sum+=dataArr[i];
     const avg=sum/dataArr.length;
     const level=Math.min(100,Math.round(avg*1.45));
     setMicLevel(level);
     if(socketRef.current?.connected){
      socketRef.current.emit('audio:state',{isMuted:false,audioLevel:level});
     }
    },180);
   }

   // Attach track to all existing peer connections & announce readiness so everyone hears us
   for(const [peerId,pc] of peersRef.current.entries()){
    closePeer(peerId);
    getOrCreatePeer(peerId,true);
   }
   if(socketRef.current?.connected){
    socketRef.current.emit('audio:state',{isMuted:false,audioLevel:15});
    socketRef.current.emit('webrtc:ready');
   }
  }catch(err:unknown){
   setVoiceNotice('Không thể mở Mic. Hãy cấp quyền Microphone trên trình duyệt!');
   setTimeout(()=>setVoiceNotice(null),4000);
   console.error('Mic error:',err);
  }
 },[micEnabled,stopMicrophone,roomState?.members,mySocketId,echoMonitor,closePeer,getOrCreatePeer]);

 // Cleanup mic on unmount
 useEffect(()=>()=>{stopMicrophone();},[stopMicrophone]);

 // Audio & Video Control Handlers
 const handleTogglePlay=useCallback(()=>{
  lastLocalActionRef.current=Date.now();
  const nextPlaying=!isPlaying;
  setIsPlaying(nextPlaying);
  if(nextPlaying){
   playerRef.current?.play();
  }else{
   playerRef.current?.pause();
  }
  if(socketConnected&&socketRef.current){
   socketRef.current.emit('playback:control',{
    type:nextPlaying?'play':'pause',
    positionSeconds:currentTime,
   });
  }
 },[isPlaying,currentTime,socketConnected]);

 const handleSeek=useCallback((seconds:number)=>{
  lastLocalActionRef.current=Date.now();
  const clamped=Math.max(0,Math.min(duration||3600,seconds));
  setCurrentTime(clamped);
  playerRef.current?.seekTo(clamped);
  if(socketConnected&&socketRef.current){
   socketRef.current.emit('playback:control',{type:'seek',positionSeconds:clamped});
  }
 },[duration,socketConnected]);

 const handleAdjustDelay=useCallback((nextDelayMs:number)=>{
  lastLocalActionRef.current=Date.now();
  const deltaSec=(nextDelayMs-audioDelayMs)/1000;
  setAudioDelayMs(nextDelayMs);
  audioDelayRef.current=nextDelayMs;
  const nextTime=Math.max(0,currentTime+deltaSec);
  setCurrentTime(nextTime);
  playerRef.current?.seekTo(nextTime);
 },[audioDelayMs,currentTime]);

 const handleLoadOrQueue=useCallback((mode:'play_now'|'queue')=>{
  const trimmed=urlInput.trim();
  if(!trimmed){
   setUrlFeedback('Hãy dán link YouTube hoặc mã ID bài hát.');
   return;
  }
  const id=extractYouTubeId(trimmed);
  if(!id){
   setUrlFeedback('Link không hợp lệ! Hỗ trợ youtube.com/watch?v=..., youtu.be/..., shorts/...');
   return;
  }
  setUrlFeedback(null);
  setUrlInput('');

  if(mode==='play_now'){
   lastLocalActionRef.current=Date.now();
   const fallbackTitle=`YouTube (${id})`;
   setVideoId(id);
   setVideoTitle(fallbackTitle);
   setIsPlaying(true);
   setCurrentTime(0);
   playerRef.current?.loadVideoById(id,0);
   if(socketConnected&&socketRef.current){
    socketRef.current.emit('playback:control',{type:'load',videoId:id});
   }
   void fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`)
    .then(r=>r.ok?r.json():null)
    .then(d=>{if(d?.title)setVideoTitle(String(d.title));})
    .catch(()=>{});
  }else{
   const newItem:QueueItem={
    id:`q-${Date.now()}`,
    videoId:id,
    title:`YouTube (${id})`,
    addedBy:userName,
    addedAt:Date.now(),
   };
   if(socketConnected&&socketRef.current){
    socketRef.current.emit('queue:add',{videoId:id});
   }else{
    setLocalQueue(prev=>[...prev,newItem]);
    void fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`)
     .then(r=>r.ok?r.json():null)
     .then(d=>{
      if(d?.title){
       setLocalQueue(prev=>prev.map(item=>item.id===newItem.id?{...item,title:String(d.title)}:item));
      }
     })
     .catch(()=>{});
   }
   setUrlFeedback('✓ Đã thêm bài hát vào danh sách chờ!');
   setTimeout(()=>setUrlFeedback(null),2500);
  }
 },[urlInput,socketConnected,userName]);

 const handleSelectQueueItem=useCallback((item:QueueItem)=>{
  lastLocalActionRef.current=Date.now();
  setVideoId(item.videoId);
  setVideoTitle(item.title);
  setIsPlaying(true);
  setCurrentTime(0);
  playerRef.current?.loadVideoById(item.videoId,0);
  if(socketConnected&&socketRef.current){
   socketRef.current.emit('playback:control',{type:'play_queue_item',itemId:item.id});
  }else{
   setLocalHistory(prev=>[{id:`h-${Date.now()}`,videoId,title:videoTitle,addedBy:userName,addedAt:Date.now()},...prev]);
   setLocalQueue(prev=>prev.filter(q=>q.id!==item.id));
  }
 },[socketConnected,videoId,videoTitle,userName]);

 const handleRemoveQueueItem=useCallback((id:string)=>{
  if(socketConnected&&socketRef.current){
   socketRef.current.emit('queue:remove',{id});
  }else{
   setLocalQueue(prev=>prev.filter(q=>q.id!==id));
  }
 },[socketConnected]);

 const handleNextSong=useCallback(()=>{
  lastLocalActionRef.current=Date.now();
  const list=roomState?.queue??localQueue;
  if(list.length>0){
   const nextSong=list[0];
   setVideoId(nextSong.videoId);
   setVideoTitle(nextSong.title);
   setIsPlaying(true);
   setCurrentTime(0);
   playerRef.current?.loadVideoById(nextSong.videoId,0);
  }
  if(socketConnected&&socketRef.current){
   socketRef.current.emit('playback:control',{type:'next'});
   return;
  }
  if(localQueue.length>0){
   const [, ...rest]=localQueue;
   setLocalHistory(prev=>[{id:`h-${Date.now()}`,videoId,title:videoTitle,addedBy:userName,addedAt:Date.now()},...prev]);
   setLocalQueue(rest);
  }
 },[socketConnected,roomState?.queue,localQueue,videoId,videoTitle,userName]);

 const handlePrevSong=useCallback(()=>{
  lastLocalActionRef.current=Date.now();
  const hist=roomState?.history??localHistory;
  if(hist.length>0){
   const prevSong=hist[0];
   setVideoId(prevSong.videoId);
   setVideoTitle(prevSong.title);
   setIsPlaying(true);
   setCurrentTime(0);
   playerRef.current?.loadVideoById(prevSong.videoId,0);
  }
  if(socketConnected&&socketRef.current){
   socketRef.current.emit('playback:control',{type:'back'});
   return;
  }
  if(localHistory.length>0){
   const [, ...rest]=localHistory;
   setLocalQueue(q=>[{id:`q-${Date.now()}`,videoId,title:videoTitle,addedBy:userName,addedAt:Date.now()},...q]);
   setLocalHistory(rest);
  }
 },[socketConnected,roomState?.history,localHistory,videoId,videoTitle,userName]);

 // Emit local 3D avatar movement to room peers
 const handleLocalPose=useCallback((pose:LocalPlayerPose)=>{
  if(socketRef.current?.connected){
   socketRef.current.emit('player:move',{...pose,avatarId});
  }
 },[avatarId]);

 // Remote 3D members to render inside the 3D scene
 const remoteMembers=useMemo(()=>{
  if(!roomState?.members)return [];
  return roomState.members
   .filter(m=>m.id!==mySocketId)
   .map(m=>({...m,...(remoteMovedMap[m.id]||{})}));
 },[roomState?.members,mySocketId,remoteMovedMap]);

 const meMember=useMemo(()=>roomState?.members.find(m=>m.id===mySocketId),[roomState?.members,mySocketId]);
 const isAdmin=meMember?.role==='admin';
 const isSinger=meMember?.role==='singer';

 const command=useCallback((type:GameCommand['type'])=>{control.current.commands.push({type} as GameCommand);},[]);
 const onAction=useCallback((act:WorldAction)=>{
  if(act.type==='tv'){
   handleTogglePlay();
   setMessage('Đã chuyển trạng thái phát TV 3D.');
  }else{
   setMessage(act.message);
  }
 },[handleTogglePlay]);
 const onStatus=useCallback((next:WorldStatus)=>setStatus(next),[]);

 useEffect(()=>{
  preloadGameAssets();
  const m=window.matchMedia('(pointer: coarse)');
  const change=()=>{setShowJoystick(m.matches);};
  change();m.addEventListener('change',change);return ()=>m.removeEventListener('change',change);
 },[]);

 useEffect(()=>{
  const down=(e:KeyboardEvent)=>{
   if(e.code==='Escape'){setShowHelp(false);return;}
   const el=e.target;if(el instanceof HTMLElement&&(el.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(el.tagName)))return;
   if(moveKeys.has(e.code)){control.current.keys.add(e.code);e.preventDefault();return;}
   if(e.repeat)return;
   if(e.code==='KeyE'){command('interact');e.preventDefault();}
   else if(e.code==='KeyF'){handleTogglePlay();e.preventDefault();}
   else if(e.code==='Space'){command('jump');e.preventDefault();}
  };
  const up=(e:KeyboardEvent)=>control.current.keys.delete(e.code);
  const blur=()=>{control.current.keys.clear();control.current.joystick={x:0,y:0};control.current.runHeld=false;setKnob({x:0,y:0});};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);
  return ()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};
 },[command,handleTogglePlay]);

 const moveStick=(e:ReactPointerEvent<HTMLDivElement>)=>{
  const rect=stick.current?.getBoundingClientRect();if(!rect)return;
  const pos=joystickFromPointer(e.clientX,e.clientY,rect,42);
  control.current.joystick={x:pos.x,y:pos.y};setKnob({x:pos.knobX,y:pos.knobY});
 };
 const startStick=(e:ReactPointerEvent<HTMLDivElement>)=>{if(pointer.current!==null)return;pointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);moveStick(e);};
 const moveStickActive=(e:ReactPointerEvent<HTMLDivElement>)=>{if(pointer.current===e.pointerId)moveStick(e);};
 const endStick=(e:ReactPointerEvent<HTMLDivElement>)=>{if(pointer.current!==e.pointerId)return;pointer.current=null;
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  control.current.joystick={x:0,y:0};setKnob({x:0,y:0});};

 const toggleCamera=()=>{command('camera-toggle');setCameraMode(s=>s==='follow'?'overview':'follow');};
 const doInteract=()=>command(status.seated?'stand':'interact');
 const busy=status.seatPhase!=='idle'&&status.seatPhase!=='sitting';
 const canInteract=status.seated||!!status.near;
 const memberCount=roomState?.members.length||1;

 return <main className="music-app">
  {/* 3D Scene Viewport + True 3D CSS Perspective YouTube TV Screen */}
  <div className="scene-wrap" aria-label="Phòng Music Box 3D">
   <GameCanvas
    roomSizeMode="friends"
    avatarId={avatarId}
    controls={control}
    tvOverlayRefs={{stage:cssStageRef,camera:cssCameraRef,screen:cssScreenRef}}
    tvMedia={{videoId,title:videoTitle,playing:isPlaying,currentTime,duration}}
    remoteMembers={remoteMembers}
    onLocalPose={handleLocalPose}
    onStatus={onStatus}
    onAction={onAction}
   />
   {/* 3D-Projected YouTube IFrame Overlay locked in 3D perspective to ROOM.tv.screenCenter */}
   <div ref={cssStageRef} className="css3d-stage" aria-hidden="true">
    <div ref={cssCameraRef} className="css3d-camera">
     <div ref={cssScreenRef} className={`css3d-tv-screen ${isPlaying?'tv-live-active':'tv-live-idle'}`}>
      <YouTubePlayer
       ref={playerRef}
       videoId={videoId}
       playbackStatus={isPlaying?'playing':'paused'}
       personalVolume={personalVolume}
       isMuted={isMuted}
       onStateChange={(st)=>{
        if(st==='PLAYING')setIsPlaying(true);
        else if(st==='ENDED')handleNextSong();
       }}
       onTimeUpdate={(cur,dur)=>{
        setCurrentTime(cur);
        if(dur>0)setDuration(dur);
       }}
      />
     </div>
    </div>
   </div>
  </div>

  {/* Clean Header Bar with Room Link Sharing & Quick Mic Toggle */}
  <header className="topbar">
   <div className="brand" onClick={()=>setPanelOpen(s=>!s)} title="Bấm để đóng/mở bảng điều khiển">
    <span className="brand-icon">♫</span>
    <strong>Music Box Online</strong>
   </div>
   <div className="topbar-actions">
    <button
     className={`share-room-pill ${copyCopied?'copied':''}`}
     onClick={handleCopyShareLink}
     title="Sao chép đường link mời bạn bè vào chung phòng này"
    >
     <span>{copyCopied?'✓':'🔗'}</span>
     <strong>{copyCopied?'Đã copy link!':`Phòng: ${roomId}`}</strong>
    </button>
    <button
     className={`mic-top-pill ${micEnabled?'mic-live':''}`}
     onClick={()=>{void handleToggleMic();}}
     title={micEnabled?'Đang bật Mic hát online (Bấm để tắt)':'Bấm để bật Mic hát online cùng mọi người'}
    >
     <span>{micEnabled?'🔴':'🎤'}</span>
     <strong>{micEnabled?'Đang Hát':'Hát Online'}</strong>
    </button>
    <div
     className="user-count-pill"
     onClick={()=>{setAudioPanelOpen(true);setActiveTab('voice');}}
     style={{cursor:'pointer'}}
     title={socketConnected?'Đã kết nối máy chủ đồng bộ (Bấm để xem thành viên)':'Chế độ phòng đơn (Local)'}
    >
     <span className={`sync-dot ${socketConnected?'online':'local'}`} />
     <span>👥</span> <strong>{memberCount}/20</strong>
    </div>
    <button
     className={`icon-btn ${audioPanelOpen?'active-icon-btn':''}`}
     onClick={()=>setAudioPanelOpen(s=>!s)}
     aria-label="Bảng điều khiển âm thanh và TV"
     title="Bật/tắt Bảng điều khiển Âm thanh, TV & Hát Online"
    >
     🎵
    </button>
    <button className="icon-btn" onClick={()=>command('dance')} aria-label="Cảm xúc / Nhảy múa" title="Nhảy múa">😊</button>
    <button
     className={`icon-btn ${panelOpen?'active-icon-btn':''}`}
     onClick={()=>setPanelOpen(s=>!s)}
     aria-label="Cài đặt nhân vật"
     title="Bật/tắt Bảng nhân vật"
    >
     ⚙️
    </button>
   </div>
  </header>

  {/* Right-Side Stacked Control Panels: Character Panel on top, Audio & Online Singing Panel directly underneath */}
  <div className="right-panel-stack">
   {panelOpen&&(
    <aside className="game-panel compact-panel" aria-label="Cài đặt nhân vật">
     <div className="panel-head">
      <strong>NHÂN VẬT &amp; ĐIỀU KHIỂN</strong>
      <button className="close-panel-btn" onClick={()=>setPanelOpen(false)} title="Thu gọn">✕</button>
     </div>
     <label htmlFor="select-avatar">Chọn nhân vật chibi</label>
     <select id="select-avatar" value={avatarId} onChange={e=>handleChangeAvatar(e.target.value)}>
      {CHARACTERS.map(a=><option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
     </select>
     <div className="panel-buttons">
      <button onClick={toggleCamera}>{cameraMode==='follow'?'◎ Toàn cảnh':'◎ Theo nhân vật'}</button>
      <button onClick={()=>{command('camera-reset');setCameraMode('follow');}}>↺ Camera</button>
      <button onClick={()=>command('wave')} disabled={busy||status.seated}>👋 Vẫy tay</button>
      <button onClick={()=>command('dance')} disabled={busy||status.seated}>♫ Nhảy múa</button>
      <button onClick={()=>{command('reset');setMessage('Đã về trung tâm phòng.');}}>⌂ Về giữa phòng</button>
      <button onClick={()=>{setShowJoystick(s=>!s);control.current.joystick={x:0,y:0};setKnob({x:0,y:0});}}>{showJoystick?'⊙ Ẩn joystick':'⊙ Joystick'}</button>
     </div>
     <div className="panel-stats">
      <span>{status.avatarReady?actions[status.action]??status.action:'Đang nạp'}</span>
      <span>FPS {status.fps||'…'}</span>
     </div>
     <p role="status">{status.seatPhase==='approaching'?'Đang đến ghế…':status.seatPhase==='turning'?'Đang xoay đúng hướng…':status.seatPhase==='sittingDown'?'Đang ngồi xuống…':status.near&&!status.seated?`Có thể ngồi: ${status.near.label}`:message}</p>
    </aside>
   )}

   {/* Dedicated Audio, TV & Online Singing Control Panel */}
   {audioPanelOpen&&(
    <aside className="game-panel audio-control-panel" aria-label="Bảng điều khiển âm thanh, TV và Hát Online">
     <div className="panel-head">
      <strong>🎵 ÂM THANH, TV &amp; HÁT ONLINE</strong>
      <button className="close-panel-btn" onClick={()=>setAudioPanelOpen(false)} title="Thu gọn">✕</button>
     </div>

     {/* Mode Switch Tabs: Nhạc & TV vs. Hát Online & Chia Sẻ Phòng */}
     <div className="panel-mode-tabs">
      <button
       className={`mode-tab-btn ${activeTab==='music'?'active':''}`}
       onClick={()=>setActiveTab('music')}
      >
       📺 Nhạc &amp; TV
      </button>
      <button
       className={`mode-tab-btn ${activeTab==='voice'?'active':''} ${micEnabled?'tab-mic-live':''}`}
       onClick={()=>setActiveTab('voice')}
      >
       🎤 Hát Online ({memberCount})
      </button>
     </div>

     {activeTab==='music'?(
      <>
       {/* Currently Playing Banner */}
       <div className="now-playing-box">
        <span className={`play-badge ${isPlaying?'playing':'paused'}`}>
         {isPlaying?'▶ ĐANG PHÁT':'⏸ TẠM DỪNG'}
        </span>
        <div className="now-playing-title" title={videoTitle}>
         {videoTitle}
        </div>
       </div>

       {/* 1. Play / Pause / Next / Prev & Seek Bar */}
       <div className="media-transport-row">
        <button className="transport-btn" onClick={handlePrevSong} title="Bài trước">⏮</button>
        <button
         className={`transport-btn primary-play-btn ${isPlaying?'is-playing':''}`}
         onClick={handleTogglePlay}
        >
         {isPlaying?'⏸ Dừng':'▶ Phát'}
        </button>
        <button className="transport-btn" onClick={handleNextSong} title="Bài tiếp theo">⏭</button>
       </div>

       <div className="control-slider-block">
        <div className="slider-label-row">
         <span>Tua video</span>
         <span className="mono-val">{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
        <input
         type="range"
         className="pastel-slider"
         min={0}
         max={Math.max(1,Math.floor(duration))}
         value={Math.min(Math.floor(currentTime),Math.max(1,Math.floor(duration)))}
         onChange={e=>handleSeek(Number(e.target.value))}
         aria-label="Tua thời gian video"
        />
       </div>

       {/* 2. Volume Adjustment */}
       <div className="control-slider-block">
        <div className="slider-label-row">
         <span>Âm thanh</span>
         <div className="inline-mini-actions">
          <button
           className="mini-pill-btn"
           onClick={()=>setIsMuted(m=>!m)}
           title={isMuted?'Bật tiếng':'Tắt tiếng'}
          >
           {isMuted||personalVolume===0?'🔇 Tắt':'🔊 Bật'}
          </button>
          <span className="mono-val">{isMuted?0:personalVolume}%</span>
         </div>
        </div>
        <div className="slider-with-steppers">
         <button
          className="step-btn"
          onClick={()=>{setIsMuted(false);setPersonalVolume(v=>Math.max(0,v-10));}}
          title="Giảm âm lượng"
         >
          –
         </button>
         <input
          type="range"
          className="pastel-slider"
          min={0}
          max={100}
          value={isMuted?0:personalVolume}
          onChange={e=>{
           setPersonalVolume(Number(e.target.value));
           if(isMuted)setIsMuted(false);
          }}
          aria-label="Chỉnh âm lượng"
         />
         <button
          className="step-btn"
          onClick={()=>{setIsMuted(false);setPersonalVolume(v=>Math.min(100,v+10));}}
          title="Tăng âm lượng"
         >
          +
         </button>
        </div>
       </div>

       {/* 3. Audio Delay / Sync Offset Adjustment */}
       <div className="control-slider-block">
        <div className="slider-label-row">
         <span>Độ trễ âm thanh</span>
         <div className="inline-mini-actions">
          <span className="mono-val">{audioDelayMs>0?`+${audioDelayMs}`:audioDelayMs} ms</span>
          {audioDelayMs!==0&&(
           <button className="mini-pill-btn" onClick={()=>handleAdjustDelay(0)}>0ms</button>
          )}
         </div>
        </div>
        <div className="slider-with-steppers">
         <button
          className="step-btn"
          onClick={()=>handleAdjustDelay(Math.max(-1500,audioDelayMs-100))}
          title="Giảm độ trễ 100ms"
         >
          –
         </button>
         <input
          type="range"
          className="pastel-slider"
          min={-1500}
          max={1500}
          step={50}
          value={audioDelayMs}
          onChange={e=>handleAdjustDelay(Number(e.target.value))}
          aria-label="Chỉnh độ trễ âm thanh"
         />
         <button
          className="step-btn"
          onClick={()=>handleAdjustDelay(Math.min(1500,audioDelayMs+100))}
          title="Tăng độ trễ 100ms"
         >
          +
         </button>
        </div>
       </div>

       {/* 4. Song Link Input & Quick Song Selection */}
       <div className="song-picker-section">
        <label htmlFor="yt-link-input">Gắn link bài hát YouTube</label>
        <div className="url-input-group">
         <input
          id="yt-link-input"
          type="text"
          className="yt-url-input"
          placeholder="Dán link YouTube hoặc ID..."
          value={urlInput}
          onChange={e=>setUrlInput(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')handleLoadOrQueue('play_now');}}
         />
         <div className="url-action-btns">
          <button className="url-play-btn" onClick={()=>handleLoadOrQueue('play_now')}>
           ▶ Phát ngay
          </button>
          <button className="url-queue-btn" onClick={()=>handleLoadOrQueue('queue')}>
           + Hàng đợi
          </button>
         </div>
        </div>
        {urlFeedback&&<p className="url-feedback-msg">{urlFeedback}</p>}

        <div className="queue-header-row">
         <span>Chọn bài nhanh ({queueList.length})</span>
        </div>
        <div className="mini-queue-list">
         {queueList.length===0?(
          <div className="empty-queue-note">Chưa có bài chờ. Hãy dán link YouTube ở trên!</div>
         ):(
          queueList.map((item,idx)=>(
           <div key={item.id} className="mini-queue-item">
            <button
             className="queue-select-btn"
             onClick={()=>handleSelectQueueItem(item)}
             title={`Phát ngay: ${item.title}`}
            >
             <span className="queue-idx">#{idx+1}</span>
             <span className="queue-song-name">{item.title}</span>
            </button>
            <button
             className="queue-del-btn"
             onClick={()=>handleRemoveQueueItem(item.id)}
             title="Xóa khỏi danh sách"
            >
             ✕
            </button>
           </div>
          ))
         )}
        </div>
       </div>
      </>
     ):(
      /* TAB 2: HÁT ONLINE & CHIA SẺ PHÒNG */
      <div className="voice-room-section">
       {/* 1. Share Link & Room Switcher */}
       <div className="control-slider-block">
        <div className="slider-label-row">
         <span>🔗 Link phòng chung</span>
         <span className="mono-val">{roomId}</span>
        </div>
        <button className="share-copy-full-btn" onClick={handleCopyShareLink}>
         {copyCopied?'✓ Đã sao chép link mời bạn bè!':'📋 Sao chép link mời bạn bè vào phòng'}
        </button>
        <div className="room-join-row">
         <input
          type="text"
          className="yt-url-input"
          placeholder="Nhập mã phòng (vd: phong-vip)"
          value={roomInput}
          onChange={e=>setRoomInput(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')handleJoinRoom();}}
         />
         <button className="url-queue-btn" onClick={()=>handleJoinRoom()}>Đổi phòng</button>
        </div>
       </div>

       {/* 2. User Display Name */}
       <div className="control-slider-block">
        <div className="slider-label-row">
         <span>👤 Tên hiển thị của bạn</span>
         <span className="mono-val">{meMember?.role==='admin'?'👑 Chủ phòng':meMember?.role==='singer'?'🎤 Ca sĩ':meMember?.role==='invited_singer'?'🎶 Hát phụ':'🎧 Khách'}</span>
        </div>
        <div className="room-join-row">
         <input
          type="text"
          className="yt-url-input"
          placeholder="Tên của bạn..."
          value={userName}
          onChange={e=>setUserName(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')handleSaveName(userName);}}
         />
         <button className="url-queue-btn" onClick={()=>handleSaveName(userName)}>Lưu tên</button>
        </div>
       </div>

       {/* 3. Karaoke Microphone Toggle + Live VU Meter */}
       <div className="control-slider-block">
        <button
         className={`karaoke-mic-btn ${micEnabled?'mic-on':''}`}
         onClick={()=>{void handleToggleMic();}}
        >
         {micEnabled?'🔴 Đang Bật Mic Hát (Bấm để tắt)':'🎤 Bật Mic Hát Online'}
        </button>
        <div className="vu-meter-wrap" title="Cường độ âm thanh giọng hát của bạn">
         <div className="vu-meter-bar" style={{width:`${micEnabled?Math.max(4,micLevel):0}%`}} />
        </div>
        <div className="slider-label-row" style={{marginTop:2}}>
         <span>🎧 Nghe giọng mình + Echo nhẹ</span>
         <button
          className="mini-pill-btn"
          onClick={()=>setEchoMonitor(s=>!s)}
         >
          {echoMonitor?'Đang Bật':'Đang Tắt'}
         </button>
        </div>
       </div>

       {/* 4. Room Singers Voice Volume */}
       <div className="control-slider-block">
        <div className="slider-label-row">
         <span>🔊 Âm lượng giọng hát phòng</span>
         <span className="mono-val">{voiceVolume}%</span>
        </div>
        <input
         type="range"
         className="pastel-slider"
         min={0}
         max={100}
         value={voiceVolume}
         onChange={e=>setVoiceVolume(Number(e.target.value))}
         aria-label="Âm lượng giọng hát mọi người"
        />
       </div>

       {voiceNotice&&<p className="url-feedback-msg">{voiceNotice}</p>}

       {/* 5. Online Members & Mic Role Management (Max 3 Mics) */}
       <div className="queue-header-row">
        <span>👥 Thành viên trong phòng ({memberCount}/20)</span>
        <span className="mono-val">Tối đa 3 Mic</span>
       </div>
       <div className="mini-queue-list member-list-scroll">
        {(roomState?.members??[{id:'local',name:userName,role:'admin',isMuted:!micEnabled,audioLevel:micLevel,canPublishMic:true,joinedAt:0}]).map(m=>{
         const isMe=m.id===mySocketId||m.id==='local';
         const singing=!m.isMuted&&(m.audioLevel||0)>6;
         const roleBadge=m.role==='admin'?'👑':m.role==='singer'?'🎤':m.role==='invited_singer'?'🎶':'🎧';
         return (
          <div key={m.id} className={`mini-queue-item ${singing?'member-singing':''}`}>
           <div className="queue-select-btn" style={{cursor:'default'}}>
            <span className="queue-idx">{roleBadge}</span>
            <span className="queue-song-name">
             {m.name}{isMe?' (Bạn)':''}
            </span>
            {!m.isMuted&&<span className="live-wave-dot" title="Đang mở Mic">🔊</span>}
           </div>
           {!isMe&&(isAdmin||isSinger)&&(
            <div className="inline-mini-actions">
             {!m.canPublishMic?(
              <button
               className="mini-pill-btn"
               onClick={()=>socketRef.current?.emit('role:invite_singer',{targetId:m.id})}
               title="Cấp quyền bật Mic hát cùng"
              >
               +🎤
              </button>
             ):(
              m.role!=='admin'&&(
               <button
                className="mini-pill-btn"
                onClick={()=>socketRef.current?.emit('role:revoke_mic',{targetId:m.id})}
                title="Thu hồi Mic"
               >
                Tắt
               </button>
              )
             )}
             {isAdmin&&m.role!=='singer'&&(
              <button
               className="mini-pill-btn"
               onClick={()=>socketRef.current?.emit('role:assign_singer',{targetId:m.id})}
               title="Chỉ định làm Ca sĩ chính"
              >
               🎤Chính
              </button>
             )}
            </div>
           )}
          </div>
         );
        })}
       </div>
      </div>
     )}
    </aside>
   )}
  </div>

  {/* Bottom-left: Joystick D-Pad & Control Hints matching Reference */}
  <div className="bottom-left-controls">
   <div className="joystick-holder">
    <div
     ref={stick}
     className="joystick"
     role="group"
     aria-label="Điều khiển di chuyển"
     onPointerDown={startStick}
     onPointerMove={moveStickActive}
     onPointerUp={endStick}
     onPointerCancel={endStick}
    >
     <span className="dpad-arrow dpad-up">▲</span>
     <span className="dpad-arrow dpad-down">▼</span>
     <span className="dpad-arrow dpad-left">◀</span>
     <span className="dpad-arrow dpad-right">▶</span>
     <span className="joystick-inner" />
     <span className="joystick-knob" style={{transform:`translate(${knob.x}px,${knob.y}px)`}} />
    </div>
   </div>

   <div className="keyboard-help">
    <div className="key-row">
     <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
     <span>Di chuyển</span>
    </div>
    <div className="key-row">
     <kbd>E</kbd>
     <span>Tương tác (Ngồi / Đứng)</span>
    </div>
   </div>
  </div>

  {/* Centered / Contextual Sitting Interaction Badge */}
  {canInteract&&(
   <div className="center-interact-badge" onClick={doInteract} role="button" tabIndex={0}>
    <kbd>E</kbd> {status.seated?'Đứng dậy':'Ngồi'}
   </div>
  )}

  {/* Bottom-right Action Buttons: Running & Dancing */}
  <div className="bottom-right-actions">
   <button className="circular-action-btn run-btn" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);control.current.runHeld=true;}} onPointerUp={()=>{control.current.runHeld=false;}} onPointerCancel={()=>{control.current.runHeld=false;}} aria-label="Chạy nhanh" title="Giữ để chạy nhanh">
    <span className="action-icon">🏃</span>
   </button>
   <button className="circular-action-btn dance-btn" onClick={()=>command(status.seated?'stand':'dance')} disabled={busy} aria-label="Nhảy múa" title="Nhảy múa">
    <span className="action-icon">🤸</span>
   </button>
  </div>

  {showHelp&&<aside className="help-popover"><strong>Hướng dẫn Music Box</strong><p>Sử dụng WASD hoặc joystick để di chuyển, nhấn [E] khi lại gần ghế để ngồi, bấm [🔗 Phòng] để copy link mời bạn bè, và dùng Bảng Điều Khiển bên phải để phát nhạc YouTube &amp; bật Mic Hát Online.</p><button onClick={()=>setShowHelp(false)}>Đã hiểu</button></aside>}
 </main>;
}
