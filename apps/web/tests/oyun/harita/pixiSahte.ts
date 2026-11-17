/* eslint-disable @typescript-eslint/no-explicit-any -- pixi sahteleri */
/**
 * Ortak `pixi.js` sahtesi (HaritaSahnesi, IzoCizimi ve SehirTuvali testleri).
 * Kullanım: `vi.mock("pixi.js", async () => (await import("./pixiSahte")).pixiSahteFabrikasi());` ve `import { kayit, sahteSifirla } from "./pixiSahte"`.
 * Sahte yalnız kaydeder: çizim komutları `calls`, oluşturulan nesneler `kayit` listelerinde.
 */
export const kayit = { graphics: [] as any[], texts: [] as any[], sprites: [] as any[], containers: [] as any[], app: null as any, /** `renderer.generateTexture` çağrıları (parsel zemini pişirme). */ bake: [] as any[] };

export function sahteSifirla(): void {
  kayit.graphics.length = 0;
  kayit.texts.length = 0;
  kayit.sprites.length = 0;
  kayit.containers.length = 0;
  kayit.bake.length = 0;
}

export class Kap {
  children: any[] = [];
  parent: any = null;
  position = { x: 0, y: 0, set(x: number, y: number = x) { this.x = x; this.y = y; } };
  scale = { v: 1, x: 1, y: 1, set(x: number, y: number = x) { this.v = x; this.x = x; this.y = y; } };
  eventMode: any;
  hitArea: any;
  cursor: any;
  zIndex = 0;
  sortableChildren = false;
  visible = true;
  alpha = 1;
  tint: any;
  mask: any = null;
  isRenderGroup: any;
  destroyed = false;
  h: Record<string, ((...a: any[]) => void)[]> = {};
  constructor(o?: any) {
    if (o && typeof o === "object" && "isRenderGroup" in o) this.isRenderGroup = o.isRenderGroup;
    kayit.containers.push(this);
  }
  addChild(...c: any[]) { for (const x of c) { x.parent = this; this.children.push(x); } return c[0]; }
  removeChild(...c: any[]) { for (const x of c) { x.parent = null; this.children = this.children.filter((y) => y !== x); } return c[0]; }
  on(n: string, f: (...a: any[]) => void) { (this.h[n] ??= []).push(f); return this; }
  off(n: string, f: (...a: any[]) => void) { this.h[n] = (this.h[n] ?? []).filter((x) => x !== f); return this; }
  destroy() { this.destroyed = true; for (const c of this.children) c.destroy?.(); }
}

export class Graphics extends Kap {
  calls: any[][] = [];
  constructor() { super(); kayit.graphics.push(this); }
  clear() { this.calls = []; return this; }
  roundRect(...a: any[]) { this.calls.push(["roundRect", ...a]); return this; }
  rect(...a: any[]) { this.calls.push(["rect", ...a]); return this; }
  circle(...a: any[]) { this.calls.push(["circle", ...a]); return this; }
  poly(...a: any[]) { this.calls.push(["poly", ...a]); return this; }
  fill(c: any) { this.calls.push(["fill", c]); return this; }
  stroke(o: any) { this.calls.push(["stroke", o]); return this; }
}

export class Sprite extends Kap {
  texture: any = null;
  anchor: any = { x: 0, y: 0, set(x: number, y: number = x) { this.x = x; this.y = y; } };
  constructor() { super(); kayit.sprites.push(this); }
  /** Pixi gibi: yok edilen sprite'ın çapası null olur (sonradan `anchor.set` atar). */
  override destroy() { super.destroy(); this.anchor = null; }
}

export class Text extends Kap {
  text: string;
  style: any;
  anchor = { set() {} };
  constructor(o: any) { super(); this.text = o.text; this.style = { ...o.style }; kayit.texts.push(this); }
}

export class Color {
  v: string;
  constructor(v: string) { this.v = v; }
  toNumber() { return this.v as unknown as number; }
}

/** Çokgen: çift-tek kuralıyla `contains`. */
export class Polygon {
  points: number[];
  constructor(p: number[] | number, ...rest: number[]) { this.points = Array.isArray(p) ? p : [p, ...rest]; }
  contains(x: number, y: number): boolean {
    const p = this.points;
    let ic = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i]!, yi = p[i + 1]!, xj = p[j]!, yj = p[j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ic = !ic;
    }
    return ic;
  }
}

/** Sahte zaman: `tick(ms)` kayıtlı dinleyicileri çağırır (ticker kapalıyken çağrılmaz). */
export class Ticker {
  maxFPS = 0;
  started = false;
  private dinleyiciler: ((t: { deltaMS: number }) => void)[] = [];
  add(f: (t: { deltaMS: number }) => void) { this.dinleyiciler.push(f); return this; }
  remove(f: (t: { deltaMS: number }) => void) { this.dinleyiciler = this.dinleyiciler.filter((x) => x !== f); return this; }
  start() { this.started = true; }
  stop() { this.started = false; }
  tick(ms: number) { for (const f of [...this.dinleyiciler]) f({ deltaMS: ms }); }
  get adet() { return this.dinleyiciler.length; }
}

export class Texture { width = 0; height = 0; destroyed = false; destroy() { this.destroyed = true; } }
export class ImageSource {
  opts: any;
  constructor(o?: any) { this.opts = o; }
}
export class Rectangle {
  constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
}

/** Sahte uygulama: ticker kapalı, `render` casus. */
export const yapApp = (vi: { fn: () => any }, bake = true): any => ({
  stage: new Kap(), screen: { width: 800, height: 560 },
  renderer: {
    background: { color: 0 }, resolution: 1,
    /** Gerçek Pixi gibi: hedefi `frame` kutusuna çizip yeni doku verir (sahte yalnız boyutu ve çağrıyı kaydeder). */
    ...(bake ? { generateTexture: (o: any) => { const t = new Texture(); t.width = o.frame.width; t.height = o.frame.height; (t as any).frame = o.frame; (t as any).cocuk = o.target.children.length; o.sonuc = t; kayit.bake.push(o); return t; } } : {}),
  },
  render: vi.fn(), canvas: document.createElement("canvas"), ticker: new Ticker(),
});

export const pixiSahteFabrikasi = () => ({ Container: Kap, Graphics, Sprite, Text, Color, Texture, ImageSource, Polygon, Ticker, Rectangle });
