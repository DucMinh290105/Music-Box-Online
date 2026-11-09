import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ACTIONS } from './catalog.js';

const required = ['AvatarRoot','Hips','BodyPivot','HeadPivot','ArmLPivot','ArmRPivot','LegLPivot','LegRPivot','MicGrip'];
const V3 = (x,y,z) => new THREE.Vector3(x,y,z);
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const smoothing = (dt,k=11) => 1-Math.exp(-k*dt);

/**
 * Reusable self-contained 3D avatar.
 * 20 GLB meshes contain separate transform nodes, animated procedurally at runtime.
 * This is NOT a skeleton retargeter for KayKit files. See KayKitAdapter.js.
 */
export class ChibiAvatar {
  constructor(gltf, data, options={}) {
    this.data=data;
    this.root=gltf.scene;
    this.root.name=`Avatar_${data.id}`;
    this.root.userData.avatarId=data.id;
    this.nodes={};
    for (const name of required) {
      const node=this.root.getObjectByName(name);
      if (!node) throw new Error(`Avatar ${data.id} is missing rig node ${name}`);
      this.nodes[name]=node;
    }
    this.parts={
      mouthSmile:this.root.getObjectByName('mouth_smile'),
      mouthSing:this.root.getObjectByName('mouth_sing'),
      mouthSurprise:this.root.getObjectByName('mouth_surprise'),
      eyes:[this.root.getObjectByName('eye_L'),this.root.getObjectByName('eye_R')],
      eyeShines:[this.root.getObjectByName('eye_shine_L'),this.root.getObjectByName('eye_shine_R')],
      blush:[this.root.getObjectByName('blush_L'),this.root.getObjectByName('blush_R')],
    };
    this.state='idle';
    this.moveSpeed=0;
    this.age=Math.random()*4;
    this.actionElapsed=0;
    this.actionDuration=0;
    this.emotion='neutral';
    this.micAllowed=false;
    this.micActive=false;
    this.speakingLevel=0;
    this.targetPosition=new THREE.Vector3();
    this.targetYaw=0;
    this.remote=false;
    this.onspeakerchange=null;
    this._rot0={};
    for (const key of ['BodyPivot','HeadPivot','ArmLPivot','ArmRPivot','LegLPivot','LegRPivot']) {
      this._rot0[key]=this.nodes[key].rotation.clone();
    }
    this._initialHips=this.nodes.Hips.position.clone();
    this._originalEyeScale=this.parts.eyes.map(n=>n?.scale.y??1);
    this._micPieces=['MicGrip','MicHead','MicHandle','MicCap'];
    this.micGroup=this.nodes.MicGrip;
    this.micGroup.visible=false;
    this._setExpression('neutral');
    const correctedMaterials=new Set();
    this.root.traverse(child=>{if(child.isMesh){if(!child.geometry.getAttribute("normal")){child.geometry=mergeVertices(child.geometry);child.geometry.computeVertexNormals();}for(const material of (Array.isArray(child.material)?child.material:[child.material]))if(material.isMeshStandardMaterial&&!material.map&&!correctedMaterials.has(material)){material.color.convertSRGBToLinear();material.flatShading=false;material.needsUpdate=true;correctedMaterials.add(material);}child.castShadow=options.castShadow??false;child.receiveShadow=true}});
  }

  static async load(data, options={}) {
    const loader=options.loader??new GLTFLoader();
    const baseUrl=options.baseUrl??'';
    const url=`${baseUrl}${data.asset}`;
    const gltf=await loader.loadAsync(url);
    return new ChibiAvatar(gltf,data,options);
  }
  get object3D(){return this.root}
  setAction(action,{duration=0,emotion=null}={}) {
    if(!ACTIONS.includes(action)) throw new Error(`Unknown animation: ${action}`);
    if(action==='sing' && !this.micAllowed) return false;
    if(this.state!==action){this.actionElapsed=0;this.state=action}
    this.actionDuration=duration;
    if(emotion) this.emotion=emotion;
    return true;
  }
  setMoveSpeed(speed){this.moveSpeed=Math.max(0,speed)}
  setEmotion(emotion){this.emotion=emotion}
  emote(action,duration=2){return this.setAction(action,{duration})}
  setMicAllowed(canUse){
    this.micAllowed=!!canUse;
    if(!this.micAllowed) {this.micActive=false;if(this.state==='sing')this.setAction('idle')}
  }
  setMicActive(active){
    if(active && !this.micAllowed) return false;
    this.micActive=!!active;
    if(!this.micActive && this.state==='sing')this.setAction('idle');
    if(this.micActive)this.setAction('sing');
    this.onspeakerchange?.(this.micActive);
    return true;
  }
  setSpeakingLevel(level){this.speakingLevel=clamp(Number(level)||0,0,1)}
  sitAt(position,yaw=0){
    this.root.position.copy(position);this.root.rotation.y=yaw;
    this.targetPosition.copy(position);this.targetYaw=yaw;
    this.remote=false;this.setAction('sit');
  }
  stand(){this.setAction('idle')}
  setRemoteState(net) {
    this.remote=true;
    if(Array.isArray(net.position)&&net.position.length===3)this.targetPosition.fromArray(net.position);
    if(typeof net.yaw==='number')this.targetYaw=net.yaw;
    if(typeof net.action==='string'&&ACTIONS.includes(net.action)){
      // Remote server must have already authorized mic state.
      if(net.micAllowed!==undefined)this.setMicAllowed(net.micAllowed);
      this.setAction(net.action);
    }
    if(net.micActive!==undefined)this.setMicActive(!!net.micActive && this.micAllowed);
    if(net.expression)this.emotion=net.expression;
    if(net.speakingLevel!==undefined)this.setSpeakingLevel(net.speakingLevel);
  }
  getNetworkState(){
    return {id:this.data.id,position:this.root.position.toArray(),yaw:this.root.rotation.y,
      action:this.state,micAllowed:this.micAllowed,micActive:this.micActive,
      expression:this.emotion,speakingLevel:Math.round(this.speakingLevel*100)/100};
  }
  _setExpression(emotion) {
    const showSing=emotion==='sing';const showSurprise=emotion==='surprised';
    if(this.parts.mouthSmile)this.parts.mouthSmile.visible=!showSing&&!showSurprise;
    if(this.parts.mouthSing){this.parts.mouthSing.visible=showSing;this.parts.mouthSing.scale.setScalar(showSing?1:.0001);}
    if(this.parts.mouthSurprise){this.parts.mouthSurprise.visible=showSurprise;this.parts.mouthSurprise.scale.setScalar(showSurprise?1:.0001)}
    const blushVisible=emotion==='shy'||emotion==='happy';
    for(const n of this.parts.blush)if(n)n.visible=blushVisible;
  }
  update(delta) {
    const dt=clamp(delta,0,0.05); if(dt<=0)return;
    this.age+=dt; this.actionElapsed+=dt;
    if(this.actionDuration>0 && this.actionElapsed>this.actionDuration){this.state='idle';this.actionDuration=0}
    const t=this.age,st=this.state;
    const speed=this.moveSpeed;
    const a=st==='walk'||st==='run'? (st==='run'?8.7:5.8):0;
    const motion=a>0?t*a:0;
    const amp=st==='run'?.72:.46;
    const pose={BodyPivot:[0,0,0],HeadPivot:[0,0,0],ArmLPivot:[0,0,-0.09],ArmRPivot:[0,0,0.09],LegLPivot:[0,0,0],LegRPivot:[0,0,0]};
    let hipsY=this._initialHips.y+Math.sin(t*2.7)*0.017;
    let expression=this.emotion==='neutral'?'neutral':this.emotion;
    if(st==='walk'||st==='run'){
      const s=Math.sin(motion);
      pose.LegLPivot[0]=s*amp;
      pose.LegRPivot[0]=-s*amp;
      pose.ArmLPivot[0]=-s*amp*.74;
      pose.ArmRPivot[0]=s*amp*.74;
      pose.BodyPivot[2]=Math.sin(motion)*.035;
      hipsY+=Math.abs(Math.cos(motion))*(st==='run'?.044:.025);
    } else if(st==='jump') {
      hipsY+=.19+.18*Math.sin(Math.min(this.actionElapsed/0.8,1)*Math.PI);
      pose.ArmLPivot[2]=1.2;pose.ArmRPivot[2]=-1.2;
      pose.LegLPivot[0]=.4;pose.LegRPivot[0]=.4;
    } else if(st==='sit') {
      hipsY=this._initialHips.y-0.23;
      pose.LegLPivot[0]=-1.40;pose.LegRPivot[0]=-1.40;
      pose.BodyPivot[0]=.08;
      pose.ArmLPivot[0]=-.18;pose.ArmRPivot[0]=-.18;
    } else if(st==='sing') {
      pose.ArmRPivot[0]=-1.65;
      pose.ArmRPivot[2]=-.28;
      pose.ArmLPivot[2]=.19;
      pose.ArmLPivot[0]=-.23+Math.sin(t*2.1)*.17;
      pose.BodyPivot[2]=Math.sin(t*1.8)*.14;
      pose.HeadPivot[2]=Math.sin(t*1.4)*.11;
      hipsY+=Math.abs(Math.sin(t*1.8))*.025;
      expression='sing';
    } else if(st==='dance') {
      pose.BodyPivot[2]=Math.sin(t*3.5)*.23;
      pose.HeadPivot[2]=-Math.sin(t*3.5)*.12;
      pose.LegLPivot[0]=Math.sin(t*3.5)*.44;
      pose.LegRPivot[0]=-Math.sin(t*3.5)*.44;
      pose.ArmLPivot[2]=1.18+Math.sin(t*5)*.48;
      pose.ArmRPivot[2]=-1.18+Math.sin(t*5)*.48;
      hipsY+=Math.abs(Math.sin(t*3.5))*.07;
      expression='happy';
    } else if(st==='wave'){
      pose.ArmRPivot[2]=2.32;
      pose.ArmRPivot[0]=Math.sin(t*9)*.23;
      pose.HeadPivot[2]=-.10;
      expression='happy';
    } else if(st==='clap'){
      pose.ArmLPivot[0]=-1.3;pose.ArmRPivot[0]=-1.3;
      pose.ArmLPivot[2]=.9+Math.sin(t*11)*.38;
      pose.ArmRPivot[2]=-.9-Math.sin(t*11)*.38;
      expression='happy';
    } else if(st==='cheer'){
      pose.ArmLPivot[2]=2.4;pose.ArmRPivot[2]=-2.4;
      pose.ArmLPivot[0]=.1;pose.ArmRPivot[0]=.1;
      hipsY+=Math.abs(Math.sin(t*6))*.07;
      expression='happy';
    } else if(st==='laugh'){
      pose.BodyPivot[0]=-.13;
      pose.HeadPivot[0]=Math.sin(t*8)*.09;
      pose.ArmLPivot[0]=-1;pose.ArmRPivot[0]=-1;
      expression='happy';
    } else if(st==='shy'){
      pose.HeadPivot[0]=.17;pose.HeadPivot[2]=.20;
      pose.ArmLPivot[0]=-1.1;pose.ArmRPivot[0]=-1.1;
      expression='shy';
    } else if(st==='heart'){
      pose.ArmLPivot[2]=1.02;pose.ArmRPivot[2]=-1.02;
      pose.ArmLPivot[0]=-1.1;pose.ArmRPivot[0]=-1.1;
      expression='happy';
    } else if(st==='interact'){
      pose.ArmRPivot[0]=-1.2;
      pose.BodyPivot[0]=.13;
    } else {
      pose.HeadPivot[2]=Math.sin(t*1.5)*.03;
      pose.BodyPivot[0]=Math.sin(t*1.7)*.014;
    }
    const mix=smoothing(dt,12);
    for (const [name,angles] of Object.entries(pose)) {
      const node=this.nodes[name]; const base=this._rot0[name];
      node.rotation.x=THREE.MathUtils.lerp(node.rotation.x,base.x+angles[0],mix);
      node.rotation.y=THREE.MathUtils.lerp(node.rotation.y,base.y+angles[1],mix);
      node.rotation.z=THREE.MathUtils.lerp(node.rotation.z,base.z+angles[2],mix);
    }
    this.nodes.Hips.position.y=THREE.MathUtils.lerp(this.nodes.Hips.position.y,hipsY,smoothing(dt,10));
    this._setExpression(expression);
    const blink = Math.sin(t*1.1+this.data.id.length)>0.985?0.08:1;
    this.parts.eyes.forEach((e,i)=>{if(e)e.scale.y=THREE.MathUtils.lerp(e.scale.y,this._originalEyeScale[i]*blink,smoothing(dt,18))});
    this.parts.eyeShines.forEach(e=>{if(e)e.visible=blink>.5});
    if(this.parts.mouthSing && expression==='sing') {
      this.parts.mouthSing.scale.y=0.65+this.speakingLevel*0.95+0.07*Math.sin(t*8);
    }
    this.micGroup.visible=st==='sing'&&this.micAllowed&&this.micActive;
    if(this.remote){
      this.root.position.lerp(this.targetPosition,smoothing(dt,9));
      let diff=((this.targetYaw-this.root.rotation.y+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
      this.root.rotation.y+=diff*smoothing(dt,9);
    }
  }
  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse(child=>{if(child.isMesh){child.geometry?.dispose();
      // If duplicated clones share materials, dispose only after last instance.
      if(child.material && !child.userData.sharedMaterial){
        (Array.isArray(child.material)?child.material:[child.material]).forEach(m=>m.dispose());
      }
    }});
  }
}

export function createChibiManager(scene) {
  const avatars=new Map();
  return {
    avatars,
    async add(data, opts={}) {
      const avatar=await ChibiAvatar.load(data,opts);
      avatars.set(data.id,avatar);scene.add(avatar.object3D);return avatar;
    },
    remove(id){const avatar=avatars.get(id);if(avatar){avatar.dispose();avatars.delete(id)}},
    update(dt){for(const a of avatars.values())a.update(dt)},
    get(id){return avatars.get(id)},
    setRemoteState(id,snapshot){avatars.get(id)?.setRemoteState(snapshot)},
    dispose(){for(const k of [...avatars.keys()])this.remove(k)}
  }
}
