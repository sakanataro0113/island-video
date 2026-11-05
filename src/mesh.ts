import type { Asset, ModelAsset, Part, PlaceAsset } from "./assets";
import { rng, type Vec3 } from "./math";

export class MeshBuilder {
  data: number[] = [];
  tri(a: Vec3, b: Vec3, c: Vec3, col: Vec3) { for (const p of [a, b, c]) this.data.push(...p, ...col); }
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, col: Vec3) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, col: Vec3) {
    const x0=cx-w/2,x1=cx+w/2,y0=cy-h/2,y1=cy+h/2,z0=cz-d/2,z1=cz+d/2;
    this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],col);
    this.quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],col);
    this.quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],col);
    this.quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],col);
    this.quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],col);
    this.quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],col);
  }
  cone(cx: number, y0: number, cz: number, r: number, h: number, sides: number, col: Vec3) {
    for (let i = 0; i < sides; i++) {
      const a = i/sides*Math.PI*2, b = (i+1)/sides*Math.PI*2;
      this.tri([cx+Math.sin(a)*r,y0,cz+Math.cos(a)*r],[cx+Math.sin(b)*r,y0,cz+Math.cos(b)*r],[cx,y0+h,cz],col);
    }
  }
  floats() { return new Float32Array(this.data); }
}

export type Terrain = PlaceAsset["terrain"];
/** 地形の高さ。中心へ行くほど高く、岸で海へ沈む。 */
export function terrainHeight(terrain: Terrain, x: number, z: number): number {
  const dz = z-terrain.centerZ, d = Math.hypot(x, dz), a = Math.atan2(dz, x);
  const edge = terrain.radius + Math.sin(a*3+1)*1.0 + Math.sin(a*7)*0.5;
  if (d > edge) return 0.25 - (d - edge)*0.5;
  const inland = Math.max(0, edge - d - 5);
  const hill = 3.2*(1-Math.exp(-inland*inland*.018));
  return 0.25 + hill + (inland > 0 ? (Math.sin(x*.9+1)+Math.sin(z*.7))*.1*Math.min(1,inland) : 0);
}

function hash3(x: number, y: number, z: number, seed: number) {
  const n = Math.sin(Math.round(x*1000)*12.9898 + Math.round(y*1000)*78.233 + Math.round(z*1000)*37.719 + seed*19.19)*43758.5453;
  return n - Math.floor(n);
}
function icosphere(m: MeshBuilder, part: Extract<Part, { shape: "sphere" }>) {
  const t = (1+Math.sqrt(5))/2, norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0]/l,v[1]/l,v[2]/l]; };
  const v = ([[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]] as Vec3[]).map(norm);
  let f: [Vec3,Vec3,Vec3][] = ([[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]] as const).map(([a,b,c]) => [v[a],v[b],v[c]]);
  const mid = (a: Vec3, b: Vec3) => norm([(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2]);
  for (let d = 0; d < part.detail; d++) f = f.flatMap(([a,b,c]) => { const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a); return [[a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]] as [Vec3,Vec3,Vec3][]; });
  const out = (q: Vec3): Vec3 => { const k = 1+(hash3(q[0],q[1],q[2],part.seed)-.5)*part.jitter*2; return [q[0]*k*part.scale[0],q[1]*k*part.scale[1],q[2]*k*part.scale[2]]; };
  for (const [a,b,c] of f) m.tri(out(a),out(b),out(c),part.color);
}
function buildPart(m: MeshBuilder, part: Part) {
  if (part.shape === "box") m.box(0,0,0,part.size[0],part.size[1],part.size[2],part.color);
  else if (part.shape === "cone") for (let i = 0; i < part.sides; i++) {
    const rim = (k: number): Vec3 => { const a = k/part.sides*Math.PI*2, j = 1+(hash3(k%part.sides,1,2,part.seed)-.5)*part.jitter*2, d = (hash3(k%part.sides,3,4,part.seed)-.5)*part.jitter*part.radius; return [Math.sin(a)*part.radius*j,d,Math.cos(a)*part.radius*j]; };
    const a = rim(i), b = rim(i+1); m.tri(a,b,[0,part.height,0],part.color); m.tri(b,a,[0,0,0],part.color);
  }
  else if (part.shape === "cylinder") for (let i = 0; i < part.sides; i++) {
    const p = (k: number, r: number, y: number): Vec3 => { const a = k/part.sides*Math.PI*2; return [Math.sin(a)*r,y,Math.cos(a)*r]; };
    const a=p(i,part.radius,0), b=p(i+1,part.radius,0), c=p(i+1,part.top,part.height), d=p(i,part.top,part.height);
    m.quad(a,b,c,d,part.color); m.tri(d,c,[0,part.height,0],part.color); m.tri(b,a,[0,0,0],part.color);
  }
  else if (part.shape === "sphere") icosphere(m, part);
  else {
    const q = part.sections;
    for (let i = 0; i < q.length-1; i++) {
      const [x0,w0,b0,t0]=q[i],[x1,w1,b1,t1]=q[i+1];
      m.quad([x0,t0,w0],[x0,b0,0],[x1,b1,0],[x1,t1,w1],part.color);
      m.quad([x1,t1,-w1],[x1,b1,0],[x0,b0,0],[x0,t0,-w0],part.color);
      m.quad([x0,t0,-w0],[x0,t0,w0],[x1,t1,w1],[x1,t1,-w1],part.color);
    }
    const end = (s: [number,number,number,number]) => { m.tri([s[0],s[3],s[1]],[s[0],s[3],-s[1]],[s[0],s[2],0],part.color); };
    end(q[0]); end(q[q.length-1]);
  }
}
function addParts(m: MeshBuilder, parts: Part[], at: Vec3 = [0,0,0], scale = 1, rotDeg = 0) {
  const c = Math.cos(rotDeg*Math.PI/180), s = Math.sin(rotDeg*Math.PI/180);
  const place = (p: Vec3): Vec3 => [at[0]+(p[0]*c+p[2]*s)*scale, at[1]+p[1]*scale, at[2]+(-p[0]*s+p[2]*c)*scale];
  const rad = Math.PI/180;
  for (const part of parts) {
    const local = new MeshBuilder(); buildPart(local, part);
    const [rx,ry,rz] = (part.rot ?? [0,0,0]).map(v => v*rad);
    const turn = (q: Vec3): Vec3 => {
      let [x,y,z] = q; [y,z] = [y*Math.cos(rx)-z*Math.sin(rx),y*Math.sin(rx)+z*Math.cos(rx)];
      [x,z] = [x*Math.cos(ry)+z*Math.sin(ry),-x*Math.sin(ry)+z*Math.cos(ry)];
      [x,y] = [x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz)];
      return [x+part.at[0],y+part.at[1],z+part.at[2]];
    };
    for (let i = 0; i < local.data.length; i += 18) {
      const v = (o: number): Vec3 => [local.data[i+o],local.data[i+o+1],local.data[i+o+2]];
      m.tri(place(turn(v(0))),place(turn(v(6))),place(turn(v(12))),part.color);
    }
  }
}
export function buildModel(asset: ModelAsset, state: string): Float32Array { const m = new MeshBuilder(); addParts(m, asset.parts[state] ?? Object.values(asset.parts)[0]); return m.floats(); }

const SAND: Vec3=[.86,.76,.53], GRASS: Vec3=[.42,.62,.33], DARK: Vec3=[.31,.5,.29];
export function buildPlace(place: PlaceAsset, byId: Map<string, Asset>): Float32Array {
  const m = new MeshBuilder(), r = rng(7), cell = .72, jit = rng(11), jitter = new Map<string, [number, number]>(), { centerZ, radius } = place.terrain;
  const pt = (i: number, j: number): Vec3 => {
    const key = `${i},${j}`;
    if (!jitter.has(key)) jitter.set(key, [(jit()-.5)*cell*.55, (jit()-.5)*cell*.55]);
    const [dx, dz] = jitter.get(key)!, x = i*cell+dx, z = centerZ+j*cell+dz;
    return [x, terrainHeight(place.terrain,x,z), z];
  };
  const n = Math.ceil((radius+4)/cell);
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const a=pt(i,j), b=pt(i+1,j), c=pt(i+1,j+1), d=pt(i,j+1), y=(a[1]+b[1]+c[1]+d[1])/4;
    if (y < -.6) continue;
    const v = .9+r()*.2, base = y < .42 ? SAND : y > 2.2 ? DARK : GRASS, col: Vec3 = [base[0]*v, base[1]*v, base[2]*v];
    m.tri(a,c,d,col); m.tri(a,b,c,[col[0]*.97,col[1]*.97,col[2]*.97]);
  }
  for (const item of place.items) {
    const a = byId.get(item.asset) as ModelAsset;
    addParts(m, a.parts[item.state ?? a.states[0]], item.ground ? [item.at[0], item.at[1]+terrainHeight(place.terrain,item.at[0],item.at[2]), item.at[2]] : item.at, item.scale, item.rot);
  }
  for (const s of place.scatter) {
    const a = byId.get(s.asset) as ModelAsset, q = rng(s.seed);
    for (let k = 0; k < s.count; k++) {
      const angle = q()*Math.PI*2, d = s.ring[0]+q()*(s.ring[1]-s.ring[0]), x = Math.cos(angle)*d, z = centerZ+Math.sin(angle)*d, sc = s.scale[0]+q()*(s.scale[1]-s.scale[0]);
      if (place.exclude.some(e => x>=e.x[0] && x<=e.x[1] && z>=e.z[0] && z<=e.z[1])) continue;
      addParts(m, a.parts[a.states[0]], [x, terrainHeight(place.terrain,x,z), z], sc, q()*360);
    }
  }
  return m.floats();
}

export function buildSea(): Float32Array {
  const m = new MeshBuilder(), n = 86, size = 2.1;
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const x=i*size, z=j*size, col: Vec3=[.13,.45,.58];
    m.tri([x,0,z],[x,0,z+size],[x+size,0,z+size],col); m.tri([x,0,z],[x+size,0,z+size],[x+size,0,z],col);
  }
  return m.floats();
}

/** 人物の部位。角を落とした八角柱で、箱より柔らかく見せる。 */
export function buildCube(): Float32Array {
  const m = new MeshBuilder(), white: Vec3 = [1,1,1], k = .3;
  const ring: [number, number][] = [[.5-k,.5],[-.5+k,.5],[-.5,.5-k],[-.5,-.5+k],[-.5+k,-.5],[.5-k,-.5],[.5,-.5+k],[.5,.5-k]];
  ring.forEach(([x,z], i) => {
    const [x2,z2] = ring[(i+1)%8];
    m.quad([x2,-.5,z2],[x,-.5,z],[x,.5,z],[x2,.5,z2],white);
    m.tri([0,.5,0],[x2,.5,z2],[x,.5,z],white);
    m.tri([0,-.5,0],[x,-.5,z],[x2,-.5,z2],white);
  });
  return m.floats();
}
export function buildDome(): Float32Array {
  const m = new MeshBuilder(), n = 24, r = 240;
  for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) {
    const p = (a: number, e: number): [Vec3, Vec3] => { const az=a/n*Math.PI*2, el=e/6*Math.PI/2; return [[Math.cos(az)*Math.cos(el)*r,Math.sin(el)*r,Math.sin(az)*Math.cos(el)*r],[0,e/6,0]]; };
    const q=[p(i,j),p(i+1,j),p(i+1,j+1),p(i,j+1)], push=(k:number)=>m.data.push(...q[k][0],...q[k][1]);
    [0,1,2,0,2,3].forEach(push);
  }
  return m.floats();
}
export function buildSkirt(): Float32Array {
  const m = new MeshBuilder(), white: Vec3 = [1,1,1], n = 18, p = (k: number, r: number, y: number): Vec3 => { const a = k/n*Math.PI*2; return [Math.sin(a)*r,y,Math.cos(a)*r*.82]; };
  for (let i = 0; i < n; i++) m.quad(p(i,.4,0),p(i+1,.4,0),p(i+1,.25,.36),p(i,.25,.36),white);
  return m.floats();
}
export function buildBlob(): Float32Array {
  const m = new MeshBuilder(), n = 12;
  for (let i = 0; i < n; i++) { const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2; m.tri([0,0,0],[Math.sin(a),0,Math.cos(a)],[Math.sin(b),0,Math.cos(b)],[0,0,0]); }
  return m.floats();
}
