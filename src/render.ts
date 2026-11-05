import { buildBlob, buildCube, buildIsland, buildSea, looksFor, terrainHeight } from "./mesh";
import { chain, clamp01, ease, identity, lerp, lookAt, perspective, rotX, rotY, scale, translate, type Mat4, type Vec3 } from "./math";
import { sceneAt, type Scene, type Script } from "./script";

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aCol;
uniform mat4 uVP, uM; uniform float uTime, uWave; out vec3 vCol; out vec3 vPos;
void main(){ vec4 w=uM*vec4(aPos,1.); if(uWave>0.){ w.y+=uWave*(sin(w.x*.9+uTime*1.1)+sin(w.z*.7+uTime*.8+w.x*.3))*.5; }
 vPos=w.xyz; vCol=aCol; gl_Position=uVP*w; }`;
const FS = `#version 300 es
precision highp float; in vec3 vCol; in vec3 vPos; out vec4 o;
uniform vec3 uTint,uSun,uSunCol,uAmb,uFog,uEye; uniform float uFogFar,uAlpha;
void main(){ vec3 n=normalize(cross(dFdx(vPos),dFdy(vPos))); if(n.y<0.&&abs(n.y)>.99)n=-n;
 vec3 c=vCol*uTint*(uAmb+uSunCol*max(dot(n,uSun),0.));
 float f=clamp(length(vPos-uEye)/uFogFar,0.,1.); o=vec4(mix(c,uFog,f*f),uAlpha); }`;

type Sky = { sky: Vec3; sun: Vec3; sunCol: Vec3; amb: Vec3 };
const SKIES: Record<Scene["time"], Sky> = {
  朝: { sky:[.72,.84,.9], sun:[-.6,.5,.6], sunCol:[.95,.88,.78], amb:[.48,.52,.56] },
  昼: { sky:[.55,.78,.93], sun:[.25,.9,.35], sunCol:[.95,.93,.86], amb:[.5,.53,.56] },
  夕方: { sky:[.95,.62,.42], sun:[.75,.32,.55], sunCol:[1.05,.68,.42], amb:[.42,.36,.44] },
  夜: { sky:[.05,.08,.17], sun:[-.3,.7,.5], sunCol:[.3,.36,.55], amb:[.14,.17,.27] },
};
const normV = (v: Vec3): Vec3 => { const l=Math.hypot(...v); return [v[0]/l,v[1]/l,v[2]/l]; };

/** ある時刻の役者の姿勢。時刻だけで決まるので、どこへ移動しても同じ絵になる。 */
export type Pose = { x:number; z:number; yaw:number; legSwing:number; armR:number; fall:number; slump:number };
export function poseAt(scene: Scene, name: string, t: number): Pose {
  const i = scene.cast.indexOf(name), n = scene.cast.length;
  const home = (idx: number) => (idx-(n-1)/2)*(n>2 ? 1.4 : 2.2);
  const others = scene.cast.filter(c => c !== name);
  const firstTarget = scene.actions.find(a => a.actor === name && a.target)?.target
    ?? scene.actions.find(a => a.target === name)?.actor ?? others[0];
  const toward = firstTarget ? Math.sign(home(scene.cast.indexOf(firstTarget))-home(i)) || 1 : 1;
  const pose: Pose = { x:home(i), z:0, yaw:toward*Math.PI/2, legSwing:0, armR:0, fall:0, slump:0 };
  for (const a of scene.actions) {
    if (a.actor !== name || t < a.start) continue;
    const raw = clamp01((t-a.start)/(a.end-a.start)), p = ease(raw);
    if (a.verb === "詰め寄る") {
      const tx = home(scene.cast.indexOf(a.target!)), stop = tx-Math.sign(tx-home(i))*.85;
      pose.x = lerp(pose.x, stop, ease(raw/.8));
      if (raw < .8) pose.legSwing = Math.sin(t*11)*.6;
    } else if (a.verb === "殴る") {
      const hit = raw < .35 ? ease(raw/.35) : 1-ease((raw-.35)/.65);
      pose.armR = -hit*2.2;
    } else if (a.verb === "倒れる") pose.fall = Math.min(1, ease(raw/.55));
    else if (a.verb === "うなだれる") pose.slump = ease(raw/.5);
    void p;
  }
  return pose;
}

function cameraAt(scene: Scene, t: number): { eye: Vec3; at: Vec3 } {
  const p = ease((t-scene.start)/scene.seconds);
  let dist = 11, az = 0;
  if (scene.camera === "ゆっくり寄る") dist = lerp(14, 8, p);
  if (scene.camera === "ゆっくり引く") dist = lerp(8, 14, p);
  if (scene.camera === "回り込む") az = lerp(-.55, .55, p);
  // 映っている人物の中心を追う。どの時刻でも位置は計算で決まる。
  const cx = scene.cast.reduce((sum, name) => { const q = poseAt(scene, name, t); return sum + q.x - Math.sign(Math.sin(q.yaw))*q.fall*.85; }, 0) / scene.cast.length;
  return { eye:[cx*.8+Math.sin(az)*dist, 1.4+dist*.14, Math.cos(az)*dist], at:[cx,1.0,0] };
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private meshes: Record<string, { vao: WebGLVertexArrayObject; count: number }> = {};
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias:true, preserveDrawingBuffer:true, alpha:false });
    if (!gl) throw new Error("このブラウザではWebGL2を使えません。");
    this.gl = gl;
    const sh = (type: number, src: string) => { const s=gl.createShader(type)!; gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)??"shader"); return s; };
    const prog = gl.createProgram()!; gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS)); gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)??"link");
    gl.useProgram(prog);
    for (const n of ["uVP","uM","uTime","uWave","uTint","uSun","uSunCol","uAmb","uFog","uEye","uFogFar","uAlpha"]) this.u[n]=gl.getUniformLocation(prog,n);
    const add=(name:string,d:Float32Array)=>{ const vao=gl.createVertexArray()!; gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12); this.meshes[name]={vao,count:d.length/6}; };
    add("island",buildIsland()); add("sea",buildSea()); add("cube",buildCube()); add("blob",buildBlob());
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  }
  private draw(name:string,m:Mat4,tint:Vec3=[1,1,1],wave=0,alpha=1){ const g=this.gl,o=this.meshes[name]; g.bindVertexArray(o.vao); g.uniformMatrix4fv(this.u.uM,false,m); g.uniform3fv(this.u.uTint,tint); g.uniform1f(this.u.uWave,wave); g.uniform1f(this.u.uAlpha,alpha); g.drawArrays(g.TRIANGLES,0,o.count); }
  private actor(name:string,scene:Scene,t:number){
    const pose=poseAt(scene,name,t),{cloth,hair}=looksFor(name),skin:Vec3=[.9,.72,.56],legs:Vec3=[.25,.22,.2];
    const y=terrainHeight(pose.x,pose.z);
    this.gl.depthMask(false); this.draw("blob",chain(translate(pose.x,y+.03,pose.z),scale(.5+pose.fall*.5,1,.5+pose.fall*.2)),[0,0,0],0,.28); this.gl.depthMask(true);
    const root=chain(translate(pose.x,y,pose.z),rotY(pose.yaw),rotX(-pose.fall*Math.PI/2*.97),translate(0,pose.fall*.2,0));
    const part=(cx:number,cy:number,cz:number,w:number,h:number,d:number,col:Vec3,base=root)=>this.draw("cube",chain(base,translate(cx,cy,cz),scale(w,h,d)),col);
    const limb=(x:number,top:number,angle:number,w:number,len:number,col:Vec3,end?:Vec3)=>{ const b=chain(root,translate(x,top,0),rotX(angle)); part(0,-len/2,0,w,len,w,col,b); if(end) part(0,-len-.05,0,w,.11,w,end,b); };
    limb(-.13,.68,pose.legSwing,.17,.66,legs); limb(.13,.68,-pose.legSwing,.17,.66,legs);
    const spine=chain(root,translate(0,.68,0),rotX(pose.slump*.22));
    part(0,.33,0,.52,.68,.3,cloth,spine);
    const armPivot=(x:number,a:number)=>{ const b=chain(spine,translate(x,.6,0),rotX(a)); part(0,-.27,0,.14,.55,.14,cloth,b); part(0,-.6,0,.13,.13,.13,skin,b); };
    armPivot(-.33,-pose.legSwing*.7+pose.slump*.1); armPivot(.33,pose.armR+pose.legSwing*.7+pose.slump*.1);
    const head=chain(spine,translate(0,.72,0),rotX(pose.slump*.4));
    part(0,.21,0,.42,.42,.42,skin,head); part(0,.42,-.02,.46,.14,.46,hair,head); part(0,.25,-.2,.46,.3,.08,hair,head);
    const eyes:Vec3=[.07,.06,.06]; part(-.1,.24,.215,.06,.06,.02,eyes,head); part(.1,.24,.215,.06,.06,.02,eyes,head);
  }
  render(script:Script,time:number){
    const g=this.gl,t=Math.min(time,script.duration),scene=sceneAt(script,t),sky=SKIES[scene.time],{eye,at}=cameraAt(scene,t);
    const c=g.canvas as HTMLCanvasElement; g.viewport(0,0,c.width,c.height);
    g.clearColor(sky.sky[0],sky.sky[1],sky.sky[2],1); g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
    const vp=chain(perspective(.72,c.width/c.height,.1,260),lookAt(eye,at));
    g.uniformMatrix4fv(this.u.uVP,false,vp); g.uniform1f(this.u.uTime,t); g.uniform3fv(this.u.uSun,normV(sky.sun)); g.uniform3fv(this.u.uSunCol,sky.sunCol); g.uniform3fv(this.u.uAmb,sky.amb); g.uniform3fv(this.u.uFog,sky.sky); g.uniform3fv(this.u.uEye,eye); g.uniform1f(this.u.uFogFar,120);
    this.draw("sea",identity(),[1,1,1],.12);
    this.draw("island",identity());
    for(const name of scene.cast) this.actor(name,scene,t);
  }
}

export const SUBTITLE_FONT=`"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif`;
export function drawSubtitle(canvas: HTMLCanvasElement, script: Script, time: number) {
  const c=canvas.getContext("2d")!,W=canvas.width,H=canvas.height,t=Math.min(time,script.duration),scene=sceneAt(script,t);
  c.clearRect(0,0,W,H);
  const font=SUBTITLE_FONT;
  c.textAlign="center"; c.lineJoin="round";
  const titleAlpha=clamp01(2.4-t);
  if(titleAlpha>0){ c.globalAlpha=titleAlpha; c.font=`700 ${W*.06}px ${font}`; c.lineWidth=W*.012; c.strokeStyle="rgba(10,20,25,.85)"; c.fillStyle="#fff"; c.strokeText(script.title,W/2,H*.12,W*.9); c.fillText(script.title,W/2,H*.12,W*.9); c.globalAlpha=1; }
  if(!scene.narration) return;
  const size=W*.05,max=W*.86; c.font=`700 ${size}px ${font}`;
  const lines:string[]=[]; let cur=""; for(const ch of scene.narration){ if(c.measureText(cur+ch).width>max){ if("、。」』）".includes(ch)){cur+=ch;lines.push(cur);cur="";continue;} lines.push(cur);cur=ch; } else cur+=ch; } if(cur)lines.push(cur);
  c.lineWidth=W*.012; c.strokeStyle="rgba(10,20,25,.9)"; c.fillStyle="#fff";
  const lh=size*1.4,y0=H*.86-(lines.length-1)*lh;
  lines.forEach((l,i)=>{ c.strokeText(l,W/2,y0+i*lh); c.fillText(l,W/2,y0+i*lh); });
}
