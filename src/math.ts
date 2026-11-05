export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export const identity = (): Mat4 => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  return o;
}
export const chain = (...m: Mat4[]): Mat4 => m.reduce(mul);
export const translate = (x: number, y: number, z: number): Mat4 => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
export const scale = (x: number, y: number, z: number): Mat4 => new Float32Array([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);
export function rotX(a: number): Mat4 { const c=Math.cos(a), s=Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
export function rotY(a: number): Mat4 { const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1/Math.tan(fovy/2), nf = 1/(near-far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v)||1; return [v[0]/l,v[1]/l,v[2]/l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function lookAt(eye: Vec3, at: Vec3, up: Vec3 = [0,1,0]): Mat4 {
  const z = norm([eye[0]-at[0],eye[1]-at[1],eye[2]-at[2]]), x = norm(cross(up,z)), y = cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const ease = (v: number) => { const t = clamp01(v); return t*t*(3-2*t); };
export const lerp = (a: number, b: number, t: number) => a+(b-a)*t;
/** 乱数を固定する。見た目が実行ごとに変わらないようにする。 */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t>>>15), t|1); t ^= t + Math.imul(t ^ (t>>>7), t|61); return ((t ^ (t>>>14))>>>0)/4294967296; };
}
export function hashName(name: string): number { let h = 2166136261; for (const c of name) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); } return h >>> 0; }
