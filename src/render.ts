import { catalog, characterByName, titleAt, looksOf, placeByName, type Asset, type Look, type ModelAsset, type PlaceAsset } from "./assets";
import { buildBlob, buildCube, buildDome, buildSkirt, buildModel, buildPlace, buildSea, terrainHeight, type Terrain } from "./mesh";
import { chain, rng, clamp01, ease, identity, lerp, lookAt, perspective, rotX, rotY, scale, translate, type Mat4, type Vec3 } from "./math";
import { sceneAt, type CameraPath, type Prop, type Scene, type Script } from "./script";
import { TIMES } from "./vocab";
import { fontString, style } from "./subtitle-style";
import { VOICE_LEAD, audioOf } from "./voice";

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
export type Pose = { x:number; z:number; yaw:number; legSwing:number; armR:number; armL:number; fall:number; slump:number; lean:number; look:number; sit:number; hold:boolean; hop:number; bust:boolean; y?:number };
export const idlePose = (): Pose => ({ x:0, z:0, yaw:0, legSwing:0, armR:0, armL:0, fall:0, slump:0, lean:0, look:0, sit:0, hold:false, hop:0, bust:false });
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

type View = { eye: Vec3; at: Vec3; up: Vec3; fov: number };
const DEFAULT_FOV = .72;
/** 画面を斜めに分けるときの線の位置(左端と右端の、上からの高さの割合)。 */
export const SPLIT: [number, number] = [.58, .42];
/** 点の列を、角を丸めた曲線にする(Catmull-Rom)。 */
function spline(pts: Vec3[], u: number): Vec3 {
  const n = pts.length - 1, f = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(f), k = f - i;
  const p0 = pts[Math.max(0, i-1)]!, p1 = pts[i]!, p2 = pts[i+1]!, p3 = pts[Math.min(n, i+2)]!;
  return [0,1,2].map(d => .5*((2*p1[d]!) + (-p0[d]!+p2[d]!)*k + (2*p0[d]!-5*p1[d]!+4*p2[d]!-p3[d]!)*k*k + (-p0[d]!+3*p1[d]!-3*p2[d]!+p3[d]!)*k*k*k)) as Vec3;
}
const pathCache = new WeakMap<object, { u: number[]; s: number[] }>();
/** 道のりの割合 s(0〜1)から、曲線の位置 u を求める。一定の速さで飛ぶため。 */
function arcU(c: CameraPath, s: number) {
  let tab = pathCache.get(c);
  if (!tab) {
    const pts = c.points.map(q => q.at), N = 240, u: number[] = [0], d: number[] = [0];
    let prev = spline(pts, 0);
    for (let i = 1; i <= N; i++) { const q = spline(pts, i/N); d.push(d[i-1]! + Math.hypot(q[0]-prev[0], q[1]-prev[1], q[2]-prev[2])); u.push(i/N); prev = q; }
    tab = { u, s: d.map(x => x / (d[N] || 1)) }; pathCache.set(c, tab);
  }
  const i = Math.max(0, tab.s.findIndex(x => x >= s) - 1), a = tab.s[i]!, b = tab.s[i+1] ?? 1;
  return lerp(tab.u[i]!, tab.u[i+1] ?? 1, b > a ? (s - a) / (b - a) : 0);
}
const yawOf = (a: Vec3, b: Vec3) => Math.atan2(b[0]-a[0], b[2]-a[2]);
function pathView(c: CameraPath, p: number): View {
  const pts = c.points.map(q => q.at), u = arcU(c, Math.min(1, Math.max(0, p)));
  const eye = spline(pts, u), du = .012, ahead = spline(pts, Math.min(1, u + du)), behind = spline(pts, Math.max(0, u - du));
  const dir = norm3([ahead[0]-behind[0], ahead[1]-behind[1], ahead[2]-behind[2]]);
  // 点に look があれば、その点の近くではそこを見る。なければ進む向きを見る
  const n = pts.length - 1, f = u * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  // 進む向きを見る。ただし上り下りで空や地面ばかり映らないよう、上下の角度を抑えて少し下を向ける
  const flat = Math.hypot(dir[0], dir[2]) || 1, pitch = Math.max(-.6, Math.min(.2, Math.asin(dir[1]))) - .1;
  const ahead10: Vec3 = [eye[0] + dir[0]/flat*Math.cos(pitch)*10, eye[1] + Math.sin(pitch)*10, eye[2] + dir[2]/flat*Math.cos(pitch)*10];
  const target = (j: number): Vec3 => c.points[j]!.look ?? ahead10;
  const t0 = target(i), t1 = target(i+1), w = ease(k);
  const at: Vec3 = [lerp(t0[0],t1[0],w), lerp(t0[1],t1[1],w), lerp(t0[2],t1[2],w)];
  // 曲がる速さに応じて傾ける(左に曲がれば左に傾く)
  let turn = yawOf(eye, ahead) - yawOf(behind, eye); turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  const roll = Math.max(-1, Math.min(1, turn * 6)) * c.bank * Math.PI / 180;
  const fwd = norm3([at[0]-eye[0], at[1]-eye[1], at[2]-eye[2]]), right = norm3([fwd[2], 0, -fwd[0]]);
  const up: Vec3 = [right[0]*Math.sin(roll), Math.cos(roll), right[2]*Math.sin(roll)];
  return { eye, at, up, fov: c.fov * Math.PI / 180 };
}
function norm3(v: Vec3): Vec3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }

function cameraAt(scene: Scene, t: number): View {
  const raw = Math.min(1, Math.max(0, (t-scene.start)/scene.seconds)), p = ease(raw);
  if (typeof scene.camera === "object" && scene.camera.kind === "path") return pathView(scene.camera, raw);
  if (typeof scene.camera === "object" && scene.camera.kind === "orbit") {
    const c = scene.camera, a = (c.start + c.turns * 360 * raw) * Math.PI / 180;
    return { eye: [c.center[0] + Math.sin(a)*c.radius, c.height, c.center[2] + Math.cos(a)*c.radius], at: c.look, up: [0,1,0], fov: (c.fov ?? DEFAULT_FOV*180/Math.PI) * Math.PI / 180 };
  }
  if (typeof scene.camera === "object") {
    const c = scene.camera, mix = (a: Vec3, b: Vec3): Vec3 => [lerp(a[0],b[0],p),lerp(a[1],b[1],p),lerp(a[2],b[2],p)];
    return { eye: mix(c.from,c.to), at: mix(c.look,c.lookTo), up: [0,1,0], fov: c.fov !== undefined ? c.fov * Math.PI / 180 : DEFAULT_FOV };
  }
  let dist = 11, az = 0;
  if (scene.camera === "ゆっくり寄る") dist = lerp(14, 8, p);
  if (scene.camera === "ゆっくり引く") dist = lerp(8, 14, p);
  if (scene.camera === "回り込む") az = lerp(-.55, .55, p);
  // 映っている人物の中心を追う。どの時刻でも位置は計算で決まる。
  const cx = scene.cast.reduce((sum, name) => { const q = poseAt(scene, name, t); return sum + q.x - Math.sign(Math.sin(q.yaw))*q.fall*.85; }, 0) / Math.max(1, scene.cast.length);
  return { eye:[cx*.8+Math.sin(az)*dist, 1.4+dist*.14, Math.cos(az)*dist], at:[cx,1.0,0], up:[0,1,0], fov:DEFAULT_FOV };
}

const PALETTES:Record<string,Vec3[]>={
  hama:[[.18,.5,.47],[.22,.42,.58],[.76,.68,.5],[.3,.58,.52],[.16,.36,.44]],
  mori:[[.42,.27,.55],[.5,.33,.2],[.33,.42,.24],[.55,.36,.5],[.38,.3,.22]],
  mixed:[[.2,.5,.46],[.7,.34,.3],[.76,.6,.25],[.4,.36,.6],[.36,.56,.34],[.62,.44,.3],[.72,.68,.56]],
};
export class Renderer {
  private gl: WebGL2RenderingContext;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private meshes: Record<string, { vao: WebGLVertexArrayObject; count: number; center?: Vec3; size?: number }> = {};
  private add!: (name: string, d: Float32Array) => void;
  triangles(name: string) { return (this.meshes[name]?.count ?? 0) / 3; }
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias:true, preserveDrawingBuffer:true, alpha:false, stencil:true });
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
    const y=(pose.y!==undefined?pose.y:terrain?terrainHeight(terrain,pose.x,pose.z):0)+pose.hop;
    if(!pose.bust){ this.gl.depthMask(false); this.draw("blob",chain(translate(pose.x,y+.03,pose.z),scale(.5+pose.fall*.5,1,.5+pose.fall*.2)),[0,0,0],0,.28); this.gl.depthMask(true); }
    const root=chain(translate(pose.x,y,pose.z),rotY(pose.yaw),translate(0,-.42*pose.sit,0),rotX(-pose.fall*Math.PI/2*.97-pose.lean),translate(0,pose.fall*.2,0),scale(height,height,height));
    const part=(cx:number,cy:number,cz:number,w:number,h:number,d:number,col:Vec3,base=root)=>this.draw("cube",chain(base,translate(cx,cy,cz),scale(w,h,d)),col);
    const limb=(x:number,top:number,angle:number,w:number,len:number,col:Vec3)=>{ const b=chain(root,translate(x,top,0),rotX(angle)); part(0,-len/2,0,w,len,w,col,b); };
    if(!pose.bust){ limb(-.13,.68,pose.legSwing-pose.sit*1.35,.17,.66,legs); limb(.13,.68,-pose.legSwing-pose.sit*1.35,.17,.66,legs); }
    const spine=chain(root,translate(0,.68,0),rotX(pose.slump*.22+stoop*.55));
    part(0,.33,0,look.skirt?.42:.52,.68,look.skirt?.26:.3,cloth,spine);
    const belt:Vec3=[cloth[0]*.5,cloth[1]*.5,cloth[2]*.5];
    part(0,.055,0,look.skirt?.45:.55,.075,look.skirt?.29:.33,belt,spine);
    part(0,.67,0,.22,.05,.2,skin,spine);
    if(look.skirt&&!pose.bust) this.draw("skirt",chain(root,translate(0,.33,0)),[cloth[0]*.82,cloth[1]*.82,cloth[2]*.82]);
    const inward=pose.hold?.48:0;
    const armPivot=(x:number,a:number)=>{ const b=chain(spine,translate(x,.6,0),rotY(-Math.sign(x)*inward),rotX(a)); part(0,-.27,0,.14,.55,.14,cloth,b); part(0,-.6,0,.13,.13,.13,skin,b); };
    armPivot(-.33,pose.armL-(pose.armL?0:pose.legSwing*.7)+pose.slump*.1); armPivot(.33,pose.armR+(pose.armR?0:pose.legSwing*.7)+pose.slump*.1);
    const head=chain(spine,translate(0,.72,0),rotX(pose.slump*.4+stoop*.2-pose.look*.75));
    part(0,.21,0,.42,.42,.42,skin,head);
    if(hairStyle!=="bald"){ part(0,.42,.005,.47,.14,.47,hair,head); part(0,hairStyle==="long"?.08:.25,-.2,.46,hairStyle==="long"?.62:.3,.08,hair,head); }
    else part(0,.42,0,.3,.05,.3,skin,head);
    if(look.chief){ const gold:Vec3=[.86,.68,.24];
      part(0,.61,0,.68,.13,.38,[cloth[0]*.62,cloth[1]*.62,cloth[2]*.62],spine);
      part(0,.34,.16,.13,.6,.025,gold,spine);
      part(0,.055,0,.57,.09,.35,gold,spine);
      part(0,.46,0,.5,.07,.5,gold,head);
      part(0,.6,0,.34,.22,.34,[cloth[0]*.55,cloth[1]*.55,cloth[2]*.55],head); }
    const eyes:Vec3=[.07,.06,.06]; part(-.1,.24,.215,.06,.06,.02,eyes,head); part(.1,.24,.215,.06,.06,.02,eyes,head);
  }
  private setup(sky:Sky,eye:Vec3,at:Vec3,t:number,far:number,clear:Vec3=sky.sky,fogFar=120,up:Vec3=[0,1,0],fov=DEFAULT_FOV,wipe=true){
    const g=this.gl,c=g.canvas as HTMLCanvasElement; g.viewport(0,0,c.width,c.height);
    if(wipe){ g.clearColor(clear[0],clear[1],clear[2],1); g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT); }
    g.uniformMatrix4fv(this.u.uVP,false,chain(perspective(fov,c.width/c.height,.25,far),lookAt(eye,at,up)));
    g.uniform1f(this.u.uTime,t); g.uniform3fv(this.u.uSun,normV(sky.sun)); g.uniform3fv(this.u.uSunCol,sky.sunCol); g.uniform3fv(this.u.uAmb,sky.amb); g.uniform3fv(this.u.uFog,clear); g.uniform3fv(this.u.uEye,eye); g.uniform1f(this.u.uFogFar,fogFar);
  }
  private villager(q:()=>number,palette?:string):Look{
    const cloths=PALETTES[palette??""]??PALETTES.mixed,hairs:Vec3[]=[[.14,.1,.08],[.3,.2,.11],[.55,.53,.48],[.1,.1,.13]],woman=q()<.5,child=q()<.14;
    return {clothes:cloths[Math.floor(q()*cloths.length)],hair:hairs[Math.floor(q()*hairs.length)],skin:[.82+q()*.1,.62+q()*.1,.46+q()*.1],height:child?.66:.86+q()*.14,hairStyle:woman?"long":"short",stoop:0,skirt:woman,chief:false};
  }
  private riders(r:NonNullable<Prop["riders"]>,at:Vec3,yaw:number,size:number,t:number){
    const q=rng(r.seed),c=Math.cos(yaw),s=Math.sin(yaw);
    for(let i=0;i<r.count;i++){
      const row=i%2,col=Math.floor(i/2),cols=Math.ceil(r.count/2),lx=(cols>1?col/(cols-1):.5)*1.7-.95,lz=row?.2:-.2;
      const look=this.villager(q,r.palette),bob=Math.sin(t*1.6+i)*.02;
      this.actor(look,{...idlePose(),bust:true,x:at[0]+(c*lx+s*lz)*size,z:at[2]+(-s*lx+c*lz)*size,y:at[1]+(.02+bob)*size,yaw:yaw+Math.PI/2,slump:.3},null);
    }
  }
  private crowdAt(c:NonNullable<Scene["crowd"]>,t:number,terrain:Terrain,local=t){
    const q=rng(c.seed),cloths:Vec3[]=PALETTES[c.palette??""]??[[.2,.5,.46],[.7,.34,.3],[.76,.6,.25],[.4,.36,.6],[.36,.56,.34],[.62,.44,.3],[.72,.68,.56]],hairs:Vec3[]=[[.14,.1,.08],[.3,.2,.11],[.55,.53,.48],[.1,.1,.13]];
    for(let i=0;i<c.count;i++){
      const a=q()*Math.PI*2,d=c.radius[0]+q()*(c.radius[1]-c.radius[0]),x=c.center[0]+Math.cos(a)*d,z=c.center[1]+Math.sin(a)*d,woman=q()<.5,phase=q()*6,height=.82+q()*.2;
      const look:Look={clothes:cloths[Math.floor(q()*cloths.length)],hair:hairs[Math.floor(q()*hairs.length)],skin:[.82+q()*.1,.62+q()*.1,.46+q()*.1],height,hairStyle:woman?"long":q()<.15?"bald":"short",stoop:0,skirt:woman,chief:false};
      const pose:Pose={...idlePose(),x,z,yaw:Math.atan2(c.center[0]-x,c.center[1]-z)};
      if(c.cheer){ pose.armR=-2.7+Math.sin(t*8+phase)*.4; if(i%2) pose.armL=pose.armR; pose.hop=Math.abs(Math.sin(t*6+phase))*.14; }
      this.actor(look,pose,terrain);
    }
    let n=0;
    for(const l of c.lines) for(let i=0;i<l.count;i++){
      const f=l.count>1?i/(l.count-1):0,x=lerp(l.from[0],l.to[0],f),z=lerp(l.from[1],l.to[1],f)+(q()-.5)*.25,phase=q()*6;
      const look=this.villager(q,l.palette??c.palette);
      const pose:Pose={...idlePose(),x,z,yaw:l.face};
      if(c.tug){ const w=Math.sin(t*7+phase); pose.armR=pose.armL=-1.5; pose.hold=true; pose.lean=.25+w*.1; pose.legSwing=w*.25; }
      const fallAt=l.fallAt??c.fallAt; if(fallAt!==undefined){ pose.fall=ease((local-fallAt-n*.05)/.35); if(pose.fall>0){ pose.armR=pose.armL=0; pose.hold=false; pose.lean=0; } }
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
    if(p.riders) this.riders(p.riders,at,yaw,p.scale,t);
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
    const t=Math.min(time,script.duration),scene=sceneAt(script,t);
    if(!scene.split){ this.view(scene,t,true); return; }
    // 画面を斜めに上下に分ける。上は scene、下は scene.split。下側の形を型(ステンシル)に描いてから、それぞれを描く
    const g=this.gl;
    this.view(scene,t,true);
    g.enable(g.STENCIL_TEST); g.clearStencil(0); g.clear(g.STENCIL_BUFFER_BIT);
    g.stencilFunc(g.ALWAYS,1,0xff); g.stencilOp(g.KEEP,g.KEEP,g.REPLACE); g.colorMask(false,false,false,false); g.depthMask(false); g.disable(g.DEPTH_TEST);
    this.splitMask();
    g.colorMask(true,true,true,true); g.depthMask(true); g.enable(g.DEPTH_TEST);
    g.stencilFunc(g.EQUAL,1,0xff); g.stencilOp(g.KEEP,g.KEEP,g.KEEP);
    this.view(scene.split,t,false);
    g.disable(g.STENCIL_TEST);
  }
  /** 1つの場面を描く。clear が false のときは色を消さずに重ねる(画面を分けた下側用)。 */
  private view(scene:Scene,t:number,clear:boolean){
    const sky=SKIES[scene.time],{eye,at,up,fov}=cameraAt(scene,t),place=this.place(scene.place);
    const big=place.terrain.radius>45;
    if(clear) this.setup(sky,eye,at,t,big?900:260,sky.sky,big?700:120,up,fov);
    else { const g=this.gl; g.clear(g.DEPTH_BUFFER_BIT); this.setup(sky,eye,at,t,big?900:260,sky.sky,big?700:120,up,fov,false); }
    this.gl.depthMask(false); this.gl.uniform1f(this.u.uSky,1); this.gl.uniform3fv(this.u.uSkyTop,sky.top); this.draw("dome",translate(eye[0],eye[1],eye[2])); this.gl.uniform1f(this.u.uSky,0); this.gl.depthMask(true);
    const lv=scene.sea?lerp(scene.sea[0],scene.sea[1],ease((t-scene.start)/scene.seconds)):0;
    this.draw("sea",translate(0,lv,0),[1,1,1],scene.storm?.45:.12);
    this.draw("place:"+place.id,identity());
    for(const name of scene.cast) this.actor(scene.looks[name],poseAt(scene,name,t),place.terrain);
    if(scene.crowd) this.crowdAt(scene.crowd,t,place.terrain,t-scene.start);
    for(const p of scene.props) this.prop(p,scene,t);
  }
  private maskProg:WebGLProgram|null=null; private maskBuf:WebGLBuffer|null=null;
  /** 画面の下側(左は高さの58%、右は42%を結ぶ斜めの線より下)を塗る。 */
  private splitMask(){
    const g=this.gl;
    if(!this.maskProg){
      const sh=(type:number,src:string)=>{ const x=g.createShader(type)!; g.shaderSource(x,src); g.compileShader(x); return x; };
      const p=g.createProgram()!; g.attachShader(p,sh(g.VERTEX_SHADER,"#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}")); g.attachShader(p,sh(g.FRAGMENT_SHADER,"#version 300 es\nprecision mediump float;out vec4 o;void main(){o=vec4(1.);}")); g.linkProgram(p); this.maskProg=p;
      this.maskBuf=g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER,this.maskBuf); g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,1-2*SPLIT[0],1,1-2*SPLIT[1],1,-1, -1,1-2*SPLIT[0],1,-1,-1,-1]),g.STATIC_DRAW);
    }
    const prev=g.getParameter(g.CURRENT_PROGRAM),vao=g.getParameter(g.VERTEX_ARRAY_BINDING);
    g.bindVertexArray(null); g.useProgram(this.maskProg); g.bindBuffer(g.ARRAY_BUFFER,this.maskBuf);
    const loc=g.getAttribLocation(this.maskProg!,"p"); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc,2,g.FLOAT,false,0,0);
    g.drawArrays(g.TRIANGLES,0,6); g.disableVertexAttribArray(loc);
    g.useProgram(prev); g.bindVertexArray(vao);
  }
}

const DEMO_A:Look={clothes:[.25,.42,.58],hair:[.17,.12,.09],skin:[.9,.72,.56],height:1,hairStyle:"short",stoop:0,skirt:false,chief:false},DEMO_B:Look={clothes:[.62,.36,.26],hair:[.1,.1,.13],skin:[.84,.64,.48],height:.96,hairStyle:"long",stoop:0,skirt:true,chief:false};
function demoScene(verb:string,target:boolean):Scene{
  const actions=[{actor:"A",verb:verb as Scene["actions"][number]["verb"],target:target?"B":undefined,start:.2,end:2.4}];
  const mutual=verb.includes("引っ張り合う");
  if(mutual) actions.push({actor:"B",verb:actions[0].verb,target:"A",start:.2,end:2.4});
  return {place:"",time:"昼",camera:"固定",cast:target?["A","B"]:["A"],positions:mutual?{A:[-.75,0],B:[.75,0]}:{},faces:{},flashback:false,storm:false,hud:true,labels:[],props:[],looks:{A:DEMO_A,B:DEMO_B},actions,narration:"",seconds:3.2,start:0};
}
function bounds(d:Float32Array){ const min=[1e9,1e9,1e9],max=[-1e9,-1e9,-1e9]; for(let i=0;i<d.length;i+=6) for(let k=0;k<3;k++){ min[k]=Math.min(min[k],d[i+k]); max[k]=Math.max(max[k],d[i+k]); } return {center:[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2] as Vec3,size:Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2])}; }

export const SUBTITLE_FONT=`"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`;
export function drawSubtitle(canvas: HTMLCanvasElement, script: Script, time: number) {
  const c=canvas.getContext("2d")!,W=canvas.width,H=canvas.height,t=Math.min(time,script.duration),scene=sceneAt(script,t);
  c.clearRect(0,0,W,H);
  const font=SUBTITLE_FONT;
  c.textAlign="center"; c.lineJoin="round";
  if(scene.storm){ c.fillStyle="rgba(8,14,24,.28)"; c.fillRect(0,0,W,H); c.strokeStyle="rgba(200,215,230,.45)"; c.lineWidth=W*.003; c.beginPath(); for(let i=0;i<140;i++){ const sx=((i*97.31+t*W*1.9)%(W*1.4))-W*.2,sy=((i*57.7%1)*H+i*13.1+t*H*2.6)%H; c.moveTo(sx,sy); c.lineTo(sx-W*.03,sy+H*.05); } c.stroke(); }
  if(scene.flashback){ c.fillStyle="rgba(120,84,36,.32)"; c.fillRect(0,0,W,H); const g=c.createRadialGradient(W/2,H/2,H*.28,W/2,H/2,H*.68); g.addColorStop(0,"rgba(20,10,0,0)"); g.addColorStop(1,"rgba(20,10,0,.55)"); c.fillStyle=g; c.fillRect(0,0,W,H); }
  c.lineJoin="round";
  if(scene.split){ c.save(); c.lineCap="butt"; c.strokeStyle="rgba(0,0,0,.45)"; c.lineWidth=W*.02; c.beginPath(); c.moveTo(-W*.05,H*SPLIT[0]+W*.0005); c.lineTo(W*1.05,H*SPLIT[1]); c.stroke(); c.strokeStyle="#fff"; c.lineWidth=W*.011; c.beginPath(); c.moveTo(-W*.05,H*SPLIT[0]); c.lineTo(W*1.05,H*SPLIT[1]); c.stroke(); c.restore(); }
  for(const l of scene.labels){ const px=l.x*W,py=l.y*H,big=W*.07,small=W*.034; c.font=`700 ${big}px ${font}`; const w=c.measureText(l.text).width; c.font=`700 ${small}px ${font}`; const bw=Math.max(w,l.sub?c.measureText(l.sub).width:0)+W*.07,bh=l.sub?W*.15:W*.105; c.fillStyle="rgba(255,255,255,.88)"; c.strokeStyle="#1a1a1a"; c.lineWidth=W*.004; c.beginPath(); c.roundRect(px-bw/2,py-bh/2,bw,bh,W*.015); c.fill(); c.stroke(); c.textAlign="center"; c.fillStyle="#1a1a1a"; c.font=`700 ${big}px ${font}`; c.fillText(l.text,px,py+(l.sub?-W*.003:W*.025)); if(l.sub){ c.fillStyle="#0017c1"; c.font=`700 ${small}px ${font}`; c.fillText(l.sub,px,py+W*.052); } }
  if(scene.caption){ const cu=W/533; c.font=`700 ${24*cu}px ${font}`; const w=c.measureText(scene.caption).width+28*cu,x=32*cu,y=130*cu,h=44*cu; c.fillStyle="#0017c1"; c.beginPath(); c.roundRect(x,y,w,h,8*cu); c.fill(); c.fillStyle="#fff"; c.textAlign="left"; c.fillText(scene.caption,x+14*cu,y+h*.7); c.textAlign="center"; }
  const u=W/533,ink="#1a1a1a",key="#0017c1",paper="rgba(255,255,255,.7)";
  c.textAlign="left"; c.textBaseline="alphabetic";
  const rounded=(x:number,y:number,w:number,h:number,r:number,tail=false)=>{ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); if(tail){ const tx=x+46*u; c.lineTo(tx+24*u,y+h); c.lineTo(tx+12*u,y+h+15*u); c.lineTo(tx,y+h); } c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); };
  const pop=scene.population;
  if(scene.hud&&(script.year!==undefined||pop!==undefined)){
    const year=script.year!==undefined?`島に来て${script.year}年目`:"",count=pop!==undefined?`${pop}人`:"";
    c.font=`700 ${29*u}px ${font}`;
    const pad=17*u,w1=year?c.measureText(year).width+pad*2:0,w2=count?c.measureText(count).width+pad*2:0,x=32*u,y=62*u,h=56*u,r=8*u;
    rounded(x,y,w1+w2,h,r); c.save(); c.clip(); c.fillStyle=paper; c.fillRect(x,y,w1,h); c.fillStyle=ink; c.fillRect(x+w1,y,w2,h); c.restore();
    rounded(x,y,w1+w2,h,r); c.lineWidth=2*u; c.strokeStyle=ink; c.stroke();
    c.fillStyle=ink; c.fillText(year,x+pad,y+h*.69); c.fillStyle="#fff"; c.fillText(count,x+w1+pad,y+h*.69);
  }
  if(!scene.narration) return;
  const tags=scene.speaker?characterByName(scene.speaker)?.tags??[]:[];
  const village=tags.includes("はま村")?"#0b7a6e":tags.includes("もり村")?"#7a3fa6":null;
  const title=speakerTitleOf(script,scene);
  if(style.mode==="chunk") drawChunks(c,W,H,scene,t,village,title);
  else drawBox(c,W,H,scene,village,rounded,u,title);
}

type Run={text:string;strong:boolean};
/** 話者名の下に出す所属と役職。設定が「最初だけ」なら、その話でその人物の最初のセリフにだけ出す。 */
function speakerTitleOf(script:Script,scene:Scene):string{
  if(!scene.speaker||!style.speaker||style.speakerTitle==="none") return "";
  if(style.speakerTitle==="first"&&script.scenes.find(s=>s.speaker===scene.speaker)!==scene) return "";
  if(scene.speakerTitle!==undefined) return scene.speakerTitle;
  const ch=characterByName(scene.speaker); return ch?titleAt(ch,script.year):"";
}
/** 字幕の文を、強調([ ])の印つきの文字に分ける。chunk のときは「」も取る。 */
function runsOf(narration:string,dropQuotes:boolean){ const out:{ch:string;strong:boolean}[]=[]; let strong=false; for(const ch of narration){ if(ch==="["){strong=true;continue;} if(ch==="]"){strong=false;continue;} if(dropQuotes&&"「」".includes(ch)) continue; out.push({ch,strong}); } return out; }
const BREAK_AFTER="、。！？!?」』…,.";
const NO_START="、。！？!?」』…ゃゅょっャュョッァィゥェォぁぃぅぇぉー,.";
/** 字幕を、一度に出す短い区切りに分ける。句読点で切り、長いものは言葉の切れ目(助詞のあと、かなから漢字に変わる所)で、なるべく均等に切る。台本の改行は区切りに使わない。 */
export function chunksOf(narration:string,max:number):Run[][]{
  type C={ch:string;strong:boolean};
  const phrases:C[][]=[]; let cur:C[]=[];
  for(const r of runsOf(narration.replace(/\s*\n\s*/g,""),true)){ cur.push(r); if(BREAK_AFTER.includes(r.ch)){ phrases.push(cur); cur=[]; } }
  if(cur.length) phrases.push(cur);
  const kind=(c?:string)=>!c?"":/[\p{Script=Han}々〆ヶ]/u.test(c)?"kanji":/[\p{Script=Katakana}ー]/u.test(c)?"kata":/[\p{Script=Hiragana}]/u.test(c)?"hira":/[0-9０-９]/.test(c)?"num":/[A-Za-z]/.test(c)?"latin":"other";
  const PARTICLE="はがをにでともへのや";
  /** i 文字目の前で切るときの良さ。高いほど自然な切れ目 */
  const score=(p:C[],i:number)=>{ const a=p[i-1]!.ch,b=p[i]!.ch,ka=kind(a),kb=kind(b);
    if(NO_START.includes(b)) return -99;
    if(ka===kb&&ka!=="hira") return -50; // 漢字やカタカナの途中では切らない
    if(p[i-1]!.strong&&p[i]!.strong) return -40; // 強調した語の途中では切らない
    let s=0; if(PARTICLE.includes(a)&&ka==="hira") s+=4; if(PARTICLE.includes(b)&&kb==="hira") s-=5; /* 助詞から始めない */ if(ka==="hira"&&(kb==="kanji"||kb==="kata"||kb==="num")) s+=2; if(ka==="hira"&&kb==="hira") s-=3; if(ka==="kanji"&&kb==="hira") s-=2; /* 送りがなや「たち」の前では切りにくくする */ if(p[i-1]!.strong!==p[i]!.strong) s+=1; return s; };
  const pieces:C[][]=[];
  for(const p of phrases){
    let rest=p;
    while(rest.length>max){
      const n=Math.ceil(rest.length/max), target=Math.round(rest.length/n); let best=-1,bestScore=-1e9;
      for(let i=Math.max(2,target-4);i<=Math.min(rest.length-2,max,target+4);i++){ const sc=score(rest,i)-Math.abs(i-target)*.6; if(sc>bestScore){bestScore=sc;best=i;} }
      if(best<0) best=Math.min(rest.length-1,max);
      pieces.push(rest.slice(0,best)); rest=rest.slice(best);
    }
    pieces.push(rest);
  }
  // 2字以下の切れ端は、句読点で終わらなければ次と、終わるなら前と合わせる(長すぎなければ)
  const merged:C[][]=[];
  for(let i=0;i<pieces.length;i++){
    const p=pieces[i]!, next=pieces[i+1], last=merged[merged.length-1], ends=BREAK_AFTER.includes(p[p.length-1]!.ch);
    if(p.length<=2&&!ends&&next&&p.length+next.length<=max+1){ pieces[i+1]=[...p,...next]; continue; }
    if(p.length<=2&&last&&last.length+p.length<=max+1) last.push(...p); else merged.push([...p]);
  }
  return merged.map(p=>{ const runs:Run[]=[]; for(const r of p){ const l=runs[runs.length-1]; if(l&&l.strong===r.strong) l.text+=r.ch; else runs.push({text:r.ch,strong:r.strong}); } return runs; });
}
const chunkLen=(runs:Run[])=>runs.reduce((n,r)=>n+[...r.text.replace(/[、。！？!?」』…,.\s]/g,"")].length,0);
/** 短い区切りを、読み上げの速さに合わせて順に出す。音声がなければ、カットの長さに合わせる。 */
function drawChunks(c:CanvasRenderingContext2D,W:number,H:number,scene:Scene,t:number,village:string|null,title:string){
  const chunks=chunksOf(scene.narration,style.chunk); if(!chunks.length) return;
  const voiced=audioOf(scene.voice)?.duration, from=scene.start+(voiced?VOICE_LEAD:.1), span=voiced??Math.max(.6,scene.seconds-.5);
  const weights=chunks.map(r=>Math.max(1,chunkLen(r))), total=weights.reduce((a,b)=>a+b,0);
  const f=(t-from)/span; let acc=0,i=0;
  for(;i<chunks.length-1;i++){ if(f<(acc+weights[i]!)/total) break; acc+=weights[i]!; }
  const shownAt=from+acc/total*span, age=Math.max(0,t-shownAt);
  const px=style.size*W, maxW=W*.9, k=style.pop&&age<.14?1+.14*(1-ease(age/.14)):1;
  c.save(); c.translate(style.x*W,style.y*H); c.scale(k,k);
  c.font=fontString(px); c.textAlign="left"; c.textBaseline="middle"; c.lineJoin="round"; c.miterLimit=2;
  // 幅に収まらなければ2行に折る
  const runs=chunks[i]!, chars=runs.flatMap(r=>[...r.text].map(ch=>({ch,strong:r.strong})));
  const lines:{ch:string;strong:boolean}[][]=[[]]; let w=0;
  for(const q of chars){ const cw=c.measureText(q.ch).width; if(w+cw>maxW&&lines[lines.length-1]!.length&&!NO_START.includes(q.ch)){ lines.push([]); w=0; } lines[lines.length-1]!.push(q); w+=cw; }
  const lh=px*style.lineHeight, top=-(lines.length-1)*lh/2;
  const label=scene.speaker?(style.speaker?scene.speaker:""):(style.narratorLabel?"歴史家の記録":"");
  const paint=(text:string,x:number,y:number,fill:string,size:number)=>{
    c.font=fontString(size);
    if(style.strokeWidth>0){ c.save(); if(style.shadow){ c.shadowColor="rgba(0,0,0,.5)"; c.shadowBlur=size*.18; c.shadowOffsetY=size*.07; } c.strokeStyle=style.stroke; c.lineWidth=size*style.strokeWidth*2; c.strokeText(text,x,y); c.restore(); }
    else if(style.shadow){ c.save(); c.shadowColor="rgba(0,0,0,.6)"; c.shadowBlur=size*.18; c.shadowOffsetY=size*.07; c.fillStyle=fill; c.fillText(text,x,y); c.restore(); }
    c.fillStyle=fill; c.fillText(text,x,y);
  };
  // 話者名は、村の色の小さな札に白い文字で出す
  if(label){ const ls=px*.5, ts=ls*.7; c.font=fontString(ls); const lw=c.measureText(label).width; c.font=fontString(ts); const tw=title?c.measureText(title).width:0;
    const ph=ls*1.45+(title?ts*1.25:0), pw=Math.max(lw,tw)+ls*1.1, bottom=top-lh*.5-ls*.25, ptop=bottom-ph;
    c.save(); if(style.shadow){ c.shadowColor="rgba(0,0,0,.35)"; c.shadowBlur=ls*.3; c.shadowOffsetY=ls*.08; } c.fillStyle=village??"#1a1a1a"; c.beginPath(); c.roundRect(-pw/2,ptop,pw,ph,ls*.42); c.fill(); c.restore();
    c.fillStyle="#ffffff"; c.font=fontString(ls); c.fillText(label,-lw/2,ptop+ls*.75);
    // 所属と役職は透かさず、細い字(DADS の N)で名前と分ける。白い字のまま村の色との比を保つ
    if(title){ c.font=fontString(ts,{...style,weight:style.font==="Noto Sans JP"?400:style.weight}); c.fillText(title,-tw/2,ptop+ls*1.45+ts*.5); }
    c.font=fontString(px); }
  lines.forEach((line,n)=>{
    c.font=fontString(px); const bandPad=px*.14;
    const gaps=style.emphasis==="band"?line.reduce((g,q,m)=>g+(q.strong&&(m===0||!line[m-1]!.strong)&&m>0?1:0)+(q.strong&&m<line.length-1&&!line[m+1]!.strong?1:0),0):0;
    const lw=line.reduce((s,q)=>s+c.measureText(q.ch).width,0)+gaps*bandPad; let x=-lw/2; const y=top+n*lh;
    // 同じ色の文字はまとめて描く(縁取りが文字の間で切れないように)
    let j=0; while(j<line.length){ let e=j; while(e<line.length&&line[e]!.strong===line[j]!.strong) e++; const text=line.slice(j,e).map(q=>q.ch).join(""); c.font=fontString(px); const tw=c.measureText(text).width; const strong=line[j]!.strong;
      // 帯は前後の文字に重ならないよう、帯の余白ぶん字送りを空ける
      if(strong&&style.emphasis==="band"){ const padY=px*.08; if(j>0) x+=bandPad; c.fillStyle=style.accent; c.beginPath(); c.roundRect(x-bandPad,y-px*.5-padY,tw+bandPad*2,px+padY*2,px*.12); c.fill(); c.fillStyle=style.color; c.fillText(text,x,y); x+=tw+(e<line.length?bandPad:0); }
      else { paint(text,x,y,strong?style.accent:(village&&!style.speaker?village:style.color),px); x+=tw; }
      j=e; }
  });
  c.restore();
}
/** 1カットの字幕を白い札にまとめて出す(以前の見た目)。 */
function drawBox(c:CanvasRenderingContext2D,W:number,H:number,scene:Scene,village:string|null,rounded:(x:number,y:number,w:number,h:number,r:number,tail?:boolean)=>void,u:number,title:string){
  const ink="#1a1a1a",paper=`rgba(255,255,255,${style.boxOpacity})`;
  const size=style.size*W*.8,boxW=W*.83,x=style.x*W-boxW/2,pad=22*u,maxW=boxW-pad*2;
  c.textAlign="left"; c.textBaseline="alphabetic"; c.font=fontString(size);
  const lines:Run[][]=[];
  for(const para of scene.narration.split("\n")){
    let line:Run[]=[],width=0,strong=false;
    const push=(ch:string)=>{ const last=line[line.length-1]; if(last&&last.strong===strong) last.text+=ch; else line.push({text:ch,strong}); width+=c.measureText(ch).width; };
    for(const ch of para){
      if(ch==="["){strong=true;continue;} if(ch==="]"){strong=false;continue;}
      if(width+c.measureText(ch).width>maxW&&!"、。」』）".includes(ch)){ lines.push(line); line=[]; width=0; }
      push(ch);
    }
    lines.push(line);
  }
  const showLabel=scene.speaker?style.speaker:style.narratorLabel;
  const who=scene.speaker??"歴史家の記録",whoSize=size*.58,lh=size*1.42,h=15*u+(showLabel?whoSize*1.35:0)+lh*lines.length+12*u,y=style.y*H-h/2;
  rounded(x,y,boxW,h,8*u,!!scene.speaker); c.fillStyle=paper; c.fill(); c.lineWidth=2*u; c.strokeStyle=ink; c.stroke();
  if(showLabel){ c.font=fontString(whoSize); c.fillStyle=village??style.accent; c.fillText(who,x+pad,y+15*u+whoSize); if(title){ const ww=c.measureText(who).width; c.font=fontString(whoSize*.72); c.fillText(title,x+pad+ww+whoSize*.5,y+15*u+whoSize); } }
  c.font=fontString(size);
  lines.forEach((line,i)=>{ let px=x+pad; const py=y+15*u+(showLabel?whoSize*1.35:0)+lh*i+size*1.08; for(const run of line){ const w=c.measureText(run.text).width; c.fillStyle=village??(run.strong?style.accent:ink); c.fillText(run.text,px,py); if(village&&run.strong) c.fillRect(px,py+5*u,w,3*u); px+=w; } });
}

