import { catalog, looksOf, placeByName, type Asset, type Look, type ModelAsset, type PlaceAsset } from "./assets";
import { buildBlob, buildCube, buildDome, buildSkirt, buildModel, buildPlace, buildSea, terrainHeight, type Terrain } from "./mesh";
import { chain, rng, clamp01, ease, identity, lerp, lookAt, perspective, rotX, rotY, scale, translate, type Mat4, type Vec3 } from "./math";
import { sceneAt, type Prop, type Scene, type Script } from "./script";
import { TIMES } from "./vocab";

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aCol;
uniform mat4 uVP, uM; uniform float uTime, uWave; out vec3 vCol; out vec3 vPos;
void main(){ vec4 w=uM*vec4(aPos,1.); if(uWave>0.){ w.y+=uWave*(sin(w.x*.9+uTime*1.1)+sin(w.z*.7+uTime*.8+w.x*.3))*.5; }
 vPos=w.xyz; vCol=aCol; gl_Position=uVP*w; }`;
const FS = `#version 300 es
precision highp float; in vec3 vCol; in vec3 vPos; out vec4 o;
uniform vec3 uTint,uSun,uSunCol,uAmb,uFog,uEye,uSkyTop; uniform float uFogFar,uAlpha,uSky;
void main(){ if(uSky>.5){ vec3 d=normalize(vPos-uEye); float s=max(dot(d,uSun),0.); vec3 k=mix(uFog,uSkyTop,pow(vCol.g,.65)); k+=uSunCol*(pow(s,18.)*.28+smoothstep(.9975,.9985,s)*.9); o=vec4(k,1.); return; }
 vec3 n=normalize(cross(dFdx(vPos),dFdy(vPos))); if(n.y<0.&&abs(n.y)>.99)n=-n;
 vec3 c=vCol*uTint*(uAmb+uSunCol*max(dot(n,uSun),0.));
 float f=clamp(length(vPos-uEye)/uFogFar,0.,1.); o=vec4(mix(c,uFog,f*f),uAlpha); }`;

type Sky = { sky: Vec3; top: Vec3; sun: Vec3; sunCol: Vec3; amb: Vec3 };
const SKIES: Record<Scene["time"], Sky> = {
  朝: { sky:[.82,.86,.86], top:[.45,.68,.88], sun:[-.6,.5,.6], sunCol:[.95,.88,.78], amb:[.48,.52,.56] },
  昼: { sky:[.72,.86,.95], top:[.3,.58,.9], sun:[.25,.9,.35], sunCol:[.95,.93,.86], amb:[.5,.53,.56] },
  夕方: { sky:[.98,.62,.38], top:[.32,.34,.58], sun:[.72,.2,-.65], sunCol:[1.05,.68,.42], amb:[.58,.5,.54] },
  夜: { sky:[.07,.1,.2], top:[.015,.025,.08], sun:[-.3,.7,.5], sunCol:[.3,.36,.55], amb:[.14,.17,.27] },
};
const normV = (v: Vec3): Vec3 => { const l=Math.hypot(...v); return [v[0]/l,v[1]/l,v[2]/l]; };

/** ある時刻の役者の姿勢。時刻だけで決まるので、どこへ移動しても同じ絵になる。 */
export type Pose = { x:number; z:number; yaw:number; legSwing:number; armR:number; armL:number; fall:number; slump:number; lean:number; look:number; sit:number; hold:boolean; hop:number };
export const idlePose = (): Pose => ({ x:0, z:0, yaw:0, legSwing:0, armR:0, armL:0, fall:0, slump:0, lean:0, look:0, sit:0, hold:false, hop:0 });
export function poseAt(scene: Scene, name: string, t: number): Pose {
  const n = scene.cast.length, homeX = (who: string) => scene.positions[who]?.[0] ?? (scene.cast.indexOf(who)-(n-1)/2)*(n>2 ? 1.4 : 2.2);
  const others = scene.cast.filter(c => c !== name);
  const firstTarget = scene.actions.find(a => a.actor === name && a.target)?.target
    ?? scene.actions.find(a => a.target === name)?.actor ?? others[0];
  const toward = firstTarget ? Math.sign(homeX(firstTarget)-homeX(name)) || 1 : 1;
  const pose: Pose = { ...idlePose(), x:homeX(name), z:scene.positions[name]?.[1] ?? 0, yaw:scene.faces[name] ?? toward*Math.PI/2 };
  for (const a of scene.actions) {
    if (a.actor !== name || t < a.start) continue;
    const raw = clamp01((t-a.start)/(a.end-a.start));
    if (a.verb === "詰め寄る") {
      const tx = homeX(a.target!), stop = tx-Math.sign(tx-homeX(name))*.85;
      pose.x = lerp(pose.x, stop, ease(raw/.8));
      if (raw < .8) pose.legSwing = Math.sin(t*11)*.6;
    } else if (a.verb === "殴る") {
      const hit = raw < .35 ? ease(raw/.35) : 1-ease((raw-.35)/.65);
      pose.armR = -hit*2.2;
    } else if (a.verb === "倒れる") pose.fall = Math.min(1, ease(raw/.55));
    else if (a.verb === "うなだれる") pose.slump = ease(raw/.5);
    else if ((a.verb === "引っ張り合う" || a.verb === "激しく引っ張り合う") && t < a.end) {
      const hard = a.verb === "激しく引っ張り合う", wave = Math.sin(t*(hard?7:3.2));
      pose.armR = pose.armL = -1.5; pose.hold = true;
      pose.x += wave*(hard?.14:.035);
      pose.lean = (hard?.2:.08)+toward*wave*(hard?.16:.03);
      pose.legSwing = hard ? Math.sin(t*9)*.28 : 0;
    } else if (a.verb === "見上げる") pose.look = ease(raw/.25);
    else if (t < a.end && a.verb === "手を振る") pose.armR = -2.7+Math.sin(t*9)*.35;
    else if (t < a.end && a.verb === "喜ぶ") { pose.armR = pose.armL = -2.8+Math.sin(t*12)*.2; pose.hop = Math.abs(Math.sin(t*7))*.22; }
    else if (a.verb === "指さす") pose.armR = -2.15*ease(raw/.15);
    else if (a.verb === "座り込む") { pose.sit = ease(raw/.45); pose.slump = pose.sit*.7; }
  }
  return pose;
}

function cameraAt(scene: Scene, t: number): { eye: Vec3; at: Vec3 } {
  const p = ease((t-scene.start)/scene.seconds);
  if (typeof scene.camera === "object") {
    const c = scene.camera, mix = (a: Vec3, b: Vec3): Vec3 => [lerp(a[0],b[0],p),lerp(a[1],b[1],p),lerp(a[2],b[2],p)];
    return { eye: mix(c.from,c.to), at: mix(c.look,c.lookTo) };
  }
  let dist = 11, az = 0;
  if (scene.camera === "ゆっくり寄る") dist = lerp(14, 8, p);
  if (scene.camera === "ゆっくり引く") dist = lerp(8, 14, p);
  if (scene.camera === "回り込む") az = lerp(-.55, .55, p);
  // 映っている人物の中心を追う。どの時刻でも位置は計算で決まる。
  const cx = scene.cast.reduce((sum, name) => { const q = poseAt(scene, name, t); return sum + q.x - Math.sign(Math.sin(q.yaw))*q.fall*.85; }, 0) / Math.max(1, scene.cast.length);
  return { eye:[cx*.8+Math.sin(az)*dist, 1.4+dist*.14, Math.cos(az)*dist], at:[cx,1.0,0] };
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private meshes: Record<string, { vao: WebGLVertexArrayObject; count: number; center?: Vec3; size?: number }> = {};
  private add!: (name: string, d: Float32Array) => void;
  triangles(name: string) { return (this.meshes[name]?.count ?? 0) / 3; }
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias:true, preserveDrawingBuffer:true, alpha:false });
    if (!gl) throw new Error("このブラウザではWebGL2を使えません。");
    this.gl = gl;
    const sh = (type: number, src: string) => { const s=gl.createShader(type)!; gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)??"shader"); return s; };
    const prog = gl.createProgram()!; gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS)); gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)??"link");
    gl.useProgram(prog);
    for (const n of ["uVP","uM","uTime","uWave","uTint","uSun","uSunCol","uAmb","uFog","uEye","uFogFar","uAlpha","uSky","uSkyTop"]) this.u[n]=gl.getUniformLocation(prog,n);
    const add=(name:string,d:Float32Array)=>{ const vao=gl.createVertexArray()!; gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12); this.meshes[name]={vao,count:d.length/6}; };
    this.add=add; add("sea",buildSea()); add("dome",buildDome()); add("skirt",buildSkirt()); add("cube",buildCube()); add("blob",buildBlob());
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  }
  private draw(name:string,m:Mat4,tint:Vec3=[1,1,1],wave=0,alpha=1){ const g=this.gl,o=this.meshes[name]; g.bindVertexArray(o.vao); g.uniformMatrix4fv(this.u.uM,false,m); g.uniform3fv(this.u.uTint,tint); g.uniform1f(this.u.uWave,wave); g.uniform1f(this.u.uAlpha,alpha); g.drawArrays(g.TRIANGLES,0,o.count); }
  private place(name:string):PlaceAsset{ const place=placeByName(name)!; const key="place:"+place.id; if(!this.meshes[key]) this.add(key,buildPlace(place,catalog.byId)); return place; }
  private actor(look:Look,pose:Pose,terrain:Terrain|null){
    const {clothes:cloth,hair,skin,height,hairStyle,stoop}=look,legs:Vec3=[.25,.22,.2];
    const y=(terrain?terrainHeight(terrain,pose.x,pose.z):0)+pose.hop;
    this.gl.depthMask(false); this.draw("blob",chain(translate(pose.x,y+.03,pose.z),scale(.5+pose.fall*.5,1,.5+pose.fall*.2)),[0,0,0],0,.28); this.gl.depthMask(true);
    const root=chain(translate(pose.x,y,pose.z),rotY(pose.yaw),translate(0,-.42*pose.sit,0),rotX(-pose.fall*Math.PI/2*.97-pose.lean),translate(0,pose.fall*.2,0),scale(height,height,height));
    const part=(cx:number,cy:number,cz:number,w:number,h:number,d:number,col:Vec3,base=root)=>this.draw("cube",chain(base,translate(cx,cy,cz),scale(w,h,d)),col);
    const limb=(x:number,top:number,angle:number,w:number,len:number,col:Vec3)=>{ const b=chain(root,translate(x,top,0),rotX(angle)); part(0,-len/2,0,w,len,w,col,b); };
    limb(-.13,.68,pose.legSwing-pose.sit*1.35,.17,.66,legs); limb(.13,.68,-pose.legSwing-pose.sit*1.35,.17,.66,legs);
    const spine=chain(root,translate(0,.68,0),rotX(pose.slump*.22+stoop*.55));
    part(0,.33,0,look.skirt?.42:.52,.68,look.skirt?.26:.3,cloth,spine);
    const belt:Vec3=[cloth[0]*.5,cloth[1]*.5,cloth[2]*.5];
    part(0,.055,0,look.skirt?.45:.55,.075,look.skirt?.29:.33,belt,spine);
    part(0,.67,0,.22,.05,.2,skin,spine);
    if(look.skirt) this.draw("skirt",chain(root,translate(0,.33,0)),[cloth[0]*.82,cloth[1]*.82,cloth[2]*.82]);
    const inward=pose.hold?.48:0;
    const armPivot=(x:number,a:number)=>{ const b=chain(spine,translate(x,.6,0),rotY(-Math.sign(x)*inward),rotX(a)); part(0,-.27,0,.14,.55,.14,cloth,b); part(0,-.6,0,.13,.13,.13,skin,b); };
    armPivot(-.33,pose.armL-(pose.armL?0:pose.legSwing*.7)+pose.slump*.1); armPivot(.33,pose.armR+(pose.armR?0:pose.legSwing*.7)+pose.slump*.1);
    const head=chain(spine,translate(0,.72,0),rotX(pose.slump*.4+stoop*.2-pose.look*.75));
    part(0,.21,0,.42,.42,.42,skin,head);
    if(hairStyle!=="bald"){ part(0,.42,-.02,.46,.14,.46,hair,head); part(0,hairStyle==="long"?.08:.25,-.2,.46,hairStyle==="long"?.62:.3,.08,hair,head); }
    else part(0,.42,0,.3,.05,.3,skin,head);
    const eyes:Vec3=[.07,.06,.06]; part(-.1,.24,.215,.06,.06,.02,eyes,head); part(.1,.24,.215,.06,.06,.02,eyes,head);
  }
  private setup(sky:Sky,eye:Vec3,at:Vec3,t:number,far:number,clear:Vec3=sky.sky,fogFar=120){
    const g=this.gl,c=g.canvas as HTMLCanvasElement; g.viewport(0,0,c.width,c.height);
    g.clearColor(clear[0],clear[1],clear[2],1); g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
    g.uniformMatrix4fv(this.u.uVP,false,chain(perspective(.72,c.width/c.height,.1,far),lookAt(eye,at)));
    g.uniform1f(this.u.uTime,t); g.uniform3fv(this.u.uSun,normV(sky.sun)); g.uniform3fv(this.u.uSunCol,sky.sunCol); g.uniform3fv(this.u.uAmb,sky.amb); g.uniform3fv(this.u.uFog,clear); g.uniform3fv(this.u.uEye,eye); g.uniform1f(this.u.uFogFar,fogFar);
  }
  private crowdAt(c:NonNullable<Scene["crowd"]>,t:number,terrain:Terrain){
    const q=rng(c.seed),cloths:Vec3[]=[[.2,.5,.46],[.7,.34,.3],[.76,.6,.25],[.4,.36,.6],[.36,.56,.34],[.62,.44,.3],[.72,.68,.56]],hairs:Vec3[]=[[.14,.1,.08],[.3,.2,.11],[.55,.53,.48],[.1,.1,.13]];
    for(let i=0;i<c.count;i++){
      const a=q()*Math.PI*2,d=c.radius[0]+q()*(c.radius[1]-c.radius[0]),x=c.center[0]+Math.cos(a)*d,z=c.center[1]+Math.sin(a)*d,woman=q()<.5,phase=q()*6,height=.82+q()*.2;
      const look:Look={clothes:cloths[Math.floor(q()*cloths.length)],hair:hairs[Math.floor(q()*hairs.length)],skin:[.82+q()*.1,.62+q()*.1,.46+q()*.1],height,hairStyle:woman?"long":q()<.15?"bald":"short",stoop:0,skirt:woman};
      const pose:Pose={...idlePose(),x,z,yaw:Math.atan2(c.center[0]-x,c.center[1]-z)};
      if(c.cheer){ pose.armR=-2.7+Math.sin(t*8+phase)*.4; if(i%2) pose.armL=pose.armR; pose.hop=Math.abs(Math.sin(t*6+phase))*.14; }
      this.actor(look,pose,terrain);
    }
    let n=0;
    for(const l of c.lines) for(let i=0;i<l.count;i++){
      const f=l.count>1?i/(l.count-1):0,x=lerp(l.from[0],l.to[0],f),z=lerp(l.from[1],l.to[1],f)+(q()-.5)*.25,woman=q()<.5,child=q()<.14,phase=q()*6;
      const look:Look={clothes:cloths[Math.floor(q()*cloths.length)],hair:hairs[Math.floor(q()*hairs.length)],skin:[.82+q()*.1,.62+q()*.1,.46+q()*.1],height:child?.66:.86+q()*.14,hairStyle:woman?"long":"short",stoop:0,skirt:woman};
      const pose:Pose={...idlePose(),x,z,yaw:l.face};
      if(c.tug){ const w=Math.sin(t*7+phase); pose.armR=pose.armL=-1.5; pose.hold=true; pose.lean=.25+w*.1; pose.legSwing=w*.25; }
      if(c.fallAt!==undefined){ pose.fall=ease((t-c.fallAt-n*.05)/.35); if(pose.fall>0){ pose.armR=pose.armL=0; pose.hold=false; pose.lean=0; } }
      n++; this.actor(look,pose,terrain);
    }
  }
  private model(id:string,state?:string){ const a=catalog.byId.get(id) as ModelAsset, st=state??a.states[0], key=`model:${id}:${st}`; if(!this.meshes[key]){ const data=buildModel(a,st); this.add(key,data); Object.assign(this.meshes[key],bounds(data)); } return key; }
  private prop(p:Prop,scene:Scene,t:number){
    const local=t-scene.start; let at:Vec3=[0,0,0],yaw=p.yaw;
    if(p.between){ const a=poseAt(scene,p.between[0],t),b=poseAt(scene,p.between[1],t); at=[(a.x+b.x)/2,p.height,(a.z+b.z)/2]; }
    else{ const k=p.path; let i=0; while(i<k.length-2&&local>k[i+1].t)i++; const a=k[i],b=k[Math.min(i+1,k.length-1)],f=b.t>a.t?ease((local-a.t)/(b.t-a.t)):0; at=[lerp(a.at[0],b.at[0],f),lerp(a.at[1],b.at[1],f),lerp(a.at[2],b.at[2],f)]; if(p.facePath&&b!==a)yaw=Math.atan2(b.at[0]-a.at[0],b.at[2]-a.at[2]); }
    const state=p.flap?p.flap[Math.floor(t*7)%2]:p.state;
    const growth=p.grow?Math.max(.001,ease((local-p.grow[0])/(p.grow[1]-p.grow[0]))):1;
    this.draw(this.model(p.asset,state),chain(translate(at[0],at[1],at[2]),rotY(yaw),scale(p.scale,p.scale,p.scale*growth)));
  }
  /** 素材1件を、背景なしで全体が収まるように描く。 */
  preview(asset:Asset,state:string,az:number,t:number){
    const bg:Vec3=[.8,.87,.86],sky=SKIES[(TIMES as readonly string[]).includes(state)?state as Scene["time"]:"昼"];
    if(asset.kind==="場所"){
      const place=this.place(asset.name),key="place:"+place.id,d=46,eye:Vec3=[Math.sin(az)*d,d*.55,place.terrain.centerZ*.5+Math.cos(az)*d],at:Vec3=[0,1.2,place.terrain.centerZ*.5];
      this.setup(sky,eye,at,t,400,sky.sky,260); this.draw("sea",identity(),[1,1,1],.12); this.draw(key,identity()); return;
    }
    if(asset.kind==="人物"){
      const eye:Vec3=[Math.sin(az)*3.5,1.35,Math.cos(az)*3.5]; this.setup(sky,eye,[0,.95,0],t,60,bg,1000);
      this.actor(looksOf(asset,state),idlePose(),null); return;
    }
    if(asset.kind==="動作"){
      const eye:Vec3=[Math.sin(az)*6.4,2,Math.cos(az)*6.4]; this.setup(sky,eye,[0,.9,0],t,60,bg,1000);
      const loop=t%3.2,scene=demoScene(asset.name,asset.kind==="動作"&&asset.needsTarget);
      for(const name of scene.cast) this.actor(scene.looks[name],poseAt(scene,name,loop),null); return;
    }
    const key=this.model(asset.id,state);
    const m=this.meshes[key],d=Math.max(1.5,m.size!/Math.tan(.36)*.72),c=m.center!;
    const eye:Vec3=[c[0]+Math.sin(az)*d,c[1]+d*.34,c[2]+Math.cos(az)*d]; this.setup(sky,eye,c,t,d*6,bg,1e6);
    this.gl.depthMask(false); this.draw("blob",chain(translate(c[0],.01,c[2]),scale(m.size!*.6,1,m.size!*.6)),[0,0,0],0,.09); this.gl.depthMask(true);
    this.draw(key,identity());
  }
  render(script:Script,time:number){
    const t=Math.min(time,script.duration),scene=sceneAt(script,t),sky=SKIES[scene.time],{eye,at}=cameraAt(scene,t),place=this.place(scene.place);
    this.setup(sky,eye,at,t,260);
    this.gl.depthMask(false); this.gl.uniform1f(this.u.uSky,1); this.gl.uniform3fv(this.u.uSkyTop,sky.top); this.draw("dome",translate(eye[0],eye[1],eye[2])); this.gl.uniform1f(this.u.uSky,0); this.gl.depthMask(true);
    this.draw("sea",identity(),[1,1,1],.12);
    this.draw("place:"+place.id,identity());
    for(const name of scene.cast) this.actor(scene.looks[name],poseAt(scene,name,t),place.terrain);
    if(scene.crowd) this.crowdAt(scene.crowd,t,place.terrain);
    for(const p of scene.props) this.prop(p,scene,t);
  }
}

const DEMO_A:Look={clothes:[.25,.42,.58],hair:[.17,.12,.09],skin:[.9,.72,.56],height:1,hairStyle:"short",stoop:0,skirt:false},DEMO_B:Look={clothes:[.62,.36,.26],hair:[.1,.1,.13],skin:[.84,.64,.48],height:.96,hairStyle:"long",stoop:0,skirt:true};
function demoScene(verb:string,target:boolean):Scene{
  const actions=[{actor:"A",verb:verb as Scene["actions"][number]["verb"],target:target?"B":undefined,start:.2,end:2.4}];
  const mutual=verb.includes("引っ張り合う");
  if(mutual) actions.push({actor:"B",verb:actions[0].verb,target:"A",start:.2,end:2.4});
  return {place:"",time:"昼",camera:"固定",cast:target?["A","B"]:["A"],positions:mutual?{A:[-.75,0],B:[.75,0]}:{},faces:{},flashback:false,labels:[],props:[],looks:{A:DEMO_A,B:DEMO_B},actions,narration:"",seconds:3.2,start:0};
}
function bounds(d:Float32Array){ const min=[1e9,1e9,1e9],max=[-1e9,-1e9,-1e9]; for(let i=0;i<d.length;i+=6) for(let k=0;k<3;k++){ min[k]=Math.min(min[k],d[i+k]); max[k]=Math.max(max[k],d[i+k]); } return {center:[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2] as Vec3,size:Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2])}; }

export const SUBTITLE_FONT=`"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`;
export function drawSubtitle(canvas: HTMLCanvasElement, script: Script, time: number) {
  const c=canvas.getContext("2d")!,W=canvas.width,H=canvas.height,t=Math.min(time,script.duration),scene=sceneAt(script,t);
  c.clearRect(0,0,W,H);
  const font=SUBTITLE_FONT;
  c.textAlign="center"; c.lineJoin="round";
  if(scene.flashback){ c.fillStyle="rgba(120,84,36,.32)"; c.fillRect(0,0,W,H); const g=c.createRadialGradient(W/2,H/2,H*.28,W/2,H/2,H*.68); g.addColorStop(0,"rgba(20,10,0,0)"); g.addColorStop(1,"rgba(20,10,0,.55)"); c.fillStyle=g; c.fillRect(0,0,W,H); }
  c.lineJoin="round";
  for(const l of scene.labels){ const px=l.x*W,py=l.y*H; c.font=`800 ${W*.075}px ${font}`; const w=c.measureText(l.text).width; c.font=`700 ${W*.036}px ${font}`; const box=Math.max(w,l.sub?c.measureText(l.sub).width:0)+W*.08,bh=l.sub?W*.15:W*.11; c.fillStyle="rgba(250,246,232,.94)"; c.fillRect(px-box/2,py-bh/2,box,bh); c.fillStyle="#17282c"; c.font=`800 ${W*.075}px ${font}`; c.fillText(l.text,px,py+(l.sub?-W*.005:W*.026)); if(l.sub){ c.font=`700 ${W*.036}px ${font}`; c.fillStyle="#52666a"; c.fillText(l.sub,px,py+W*.052); } }
  if(scene.caption){ c.font=`700 ${W*.05}px ${font}`; c.lineWidth=W*.012; c.strokeStyle="rgba(10,20,25,.85)"; c.fillStyle="#fff2c8"; c.strokeText(scene.caption,W/2,H*.17); c.fillText(scene.caption,W/2,H*.17); }
  const pop=scene.population;
  if(script.year!==undefined||pop!==undefined){ const label=[script.year!==undefined?`島に来て${script.year}年目`:"",pop!==undefined?`${pop}人`:""].filter(Boolean).join("　"); c.font=`700 ${W*.046}px ${font}`; c.lineWidth=W*.012; c.strokeStyle="rgba(10,20,25,.85)"; c.fillStyle="#fff"; c.strokeText(label,W/2,H*.1); c.fillText(label,W/2,H*.1); }
  if(!scene.narration) return;
  const size=W*.054,max=W*.8; c.font=`700 ${size}px ${font}`;
  const lines:string[]=[]; for(const para of scene.narration.split("\n")){ let cur=""; for(const ch of para){ if(c.measureText(cur+ch).width>max){ if("、。」』）".includes(ch)){cur+=ch;lines.push(cur);cur="";continue;} lines.push(cur);cur=ch; } else cur+=ch; } if(cur)lines.push(cur); }
  c.lineWidth=W*.012; c.strokeStyle="rgba(10,20,25,.9)"; c.fillStyle="#fff";
  const lh=size*1.4,y0=H*.76-(lines.length-1)*lh;
  lines.forEach((l,i)=>{ c.strokeText(l,W/2,y0+i*lh); c.fillText(l,W/2,y0+i*lh); });
}
