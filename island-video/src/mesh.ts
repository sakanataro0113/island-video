import { hashName, rng, type Vec3 } from "./math";

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

const CENTER_Z = -13, RADIUS = 16;
/** 島の地形の高さ。中心へ行くほど高く、岸で海へ沈む。 */
export function terrainHeight(x: number, z: number): number {
  const d = Math.hypot(x, z - CENTER_Z), a = Math.atan2(z - CENTER_Z, x);
  const edge = RADIUS + Math.sin(a*3+1)*1.0 + Math.sin(a*7)*0.5;
  if (d > edge) return 0.25 - (d - edge)*0.5;
  const inland = Math.max(0, edge - d - 5);
  const hill = 3.2*(1-Math.exp(-inland*inland*.018));
  return 0.25 + hill + (inland > 0 ? (Math.sin(x*.9+1)+Math.sin(z*.7))*.1*Math.min(1,inland) : 0);
}

const SAND: Vec3=[.86,.76,.53], GRASS: Vec3=[.42,.62,.33], DARK: Vec3=[.31,.5,.29], ROCK: Vec3=[.5,.5,.52], WOOD: Vec3=[.47,.32,.2], BARK: Vec3=[.36,.25,.17], LEAF: Vec3=[.2,.47,.28], ROOF: Vec3=[.62,.33,.22], WALL: Vec3=[.82,.72,.56];

export function buildIsland(): Float32Array {
  const m = new MeshBuilder(), r = rng(7), cell = 1, jit = rng(11), jitter = new Map<string, [number, number]>();
  const pt = (i: number, j: number): Vec3 => {
    const key = `${i},${j}`;
    if (!jitter.has(key)) jitter.set(key, [(jit()-.5)*cell*.55, (jit()-.5)*cell*.55]);
    const [dx, dz] = jitter.get(key)!, x = i*cell+dx, z = CENTER_Z+j*cell+dz;
    return [x, terrainHeight(x,z), z];
  };
  const n = Math.ceil((RADIUS+4)/cell);
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const a=pt(i,j), b=pt(i+1,j), c=pt(i+1,j+1), d=pt(i,j+1), y=(a[1]+b[1]+c[1]+d[1])/4;
    if (y < -.6) continue;
    const v = .93+r()*.14, base = y < .42 ? SAND : y > 2.2 ? DARK : GRASS, col: Vec3 = [base[0]*v, base[1]*v, base[2]*v];
    m.tri(a,c,d,col); m.tri(a,b,c,[col[0]*.97,col[1]*.97,col[2]*.97]);
  }
  // 大磯の漁場: 桟橋、舟、岩、小屋、木
  for (let k = 0; k < 8; k++) m.box(4.6, .42, 2.2+k*.72, 1.5, .1, .62, k%2 ? WOOD : [.52,.36,.23]);
  for (const z of [2.2, 4.8, 7.2]) for (const x of [3.95, 5.25]) m.box(x, 0, z, .14, 1, .14, BARK);
  m.box(-5, .32, 4.2, 2.6, .34, .95, WOOD); m.box(-5, .55, 4.2, 2.1, .1, .62, [.25,.17,.11]);
  m.cone(-3.7, .15, 4.2, .47, .5, 8, WOOD); m.cone(-6.3, .15, 4.2, .47, .5, 8, WOOD);
  for (const [x,z,s] of [[6.8,1.6,.9],[7.5,.6,.6],[-7,1.5,.8],[-2.5,4,.45]] as const) m.cone(x,.1,z,s,s*1.1,9,ROCK);
  m.box(-3.6,1.15,-5.5,3.2,1.8,2.5,WALL); m.cone(-3.6,2.05,-5.5,2.65,1.5,4,ROOF);
  m.box(3.9,1.05,-7,2.7,1.6,2.2,WALL); m.cone(3.9,1.85,-7,2.3,1.3,4,ROOF);
  for (let k = 0; k < 42; k++) {
    const a = r()*Math.PI*2, d = 4+r()*9, x = Math.cos(a)*d, z = CENTER_Z+Math.sin(a)*d;
    if (z > -6 && Math.abs(x) < 7) continue;
    if (z > -3) continue;
    const y = terrainHeight(x,z), h = 1.3+r()*1.2;
    m.box(x,y+.35,z,.25,.7,.25,BARK); m.cone(x,y+.55,z,1,h,10,LEAF); m.cone(x,y+.55+h*.4,z,.8,h*.8,10,[.27,.55,.32]); m.cone(x,y+.55+h*.8,z,.55,h*.6,10,[.33,.62,.37]);
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
export function buildBlob(): Float32Array {
  const m = new MeshBuilder(), n = 12;
  for (let i = 0; i < n; i++) { const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2; m.tri([0,0,0],[Math.sin(a),0,Math.cos(a)],[Math.sin(b),0,Math.cos(b)],[0,0,0]); }
  return m.floats();
}

const CLOTH: Vec3[] = [[.72,.25,.2],[.2,.42,.68],[.83,.6,.18],[.42,.3,.6],[.2,.55,.48],[.68,.42,.3]];
const HAIR: Vec3[] = [[.14,.1,.08],[.32,.2,.11],[.5,.47,.42],[.1,.1,.13]];
export function looksFor(name: string) { const h = hashName(name); return { cloth: CLOTH[h % CLOTH.length], hair: HAIR[(h>>>8) % HAIR.length] }; }
