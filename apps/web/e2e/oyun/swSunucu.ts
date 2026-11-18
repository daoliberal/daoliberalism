/**
 * B7 e2e yardimcilari (Node): derleme kopyalari, yeni model paketli ikinci surum ve yerel `wrangler dev` sunucusu (deploy YOK).
 * Hicbir sey depoya yazilmaz: model dosyasi degisikligi gecici bir KOPYADA yapilir.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export const WEB = path.resolve(import.meta.dirname, "../..");
export const REPO = path.resolve(WEB, "../..");

export function gecici(): string {
  return mkdtempSync(path.join(tmpdir(), "oyun-sw-e2e-"));
}

/** Testin degistirecegi `apps/web/out` (paylasilan derleme ciktisi) once yedeklenir, sonunda geri konur: baska bir sunucu/deploy yanlis derlemeyi gormesin. */
export function outYedekle(tmp: string): boolean {
  const out = path.join(WEB, "out");
  if (!existsSync(out)) return false;
  cpSync(out, path.join(tmp, "out-yedek"), { recursive: true });
  return true;
}

export function outGeriYukle(tmp: string, yedekVar: boolean): void {
  const out = path.join(WEB, "out");
  rmSync(out, { recursive: true, force: true });
  if (yedekVar) cpSync(path.join(tmp, "out-yedek"), out, { recursive: true });
}

/** `pnpm build` (bayrakli ya da bayraksiz); `out/` kopyalanir. */
export function derle(bayrakli: boolean, hedef: string): void {
  const env = { ...process.env, NEXT_PUBLIC_OYUN_KAYNAK: bayrakli ? "tarayici" : "" };
  if (!bayrakli) delete (env as Record<string, string | undefined>).NEXT_PUBLIC_OYUN_KAYNAK;
  execFileSync("pnpm", ["build"], { cwd: WEB, env, stdio: "pipe", timeout: 300_000 });
  rmSync(hedef, { recursive: true, force: true });
  cpSync(path.join(WEB, "out"), hedef, { recursive: true });
}

export interface ModelSurumu {
  zipAd: string;
  model: string;
}

export function manifestOku(dizin: string): ModelSurumu {
  const m = JSON.parse(readFileSync(path.join(dizin, "oyun/manifest.json"), "utf-8")) as { model_sha256: string; paket: { ad: string } };
  return { zipAd: m.paket.ad, model: m.model_sha256 };
}

/**
 * Ikinci surum: `kaynak` derlemesinin kopyasi + YENI model paketi (model agacinin gecici kopyasinda zararsiz bir yorum eklenir; depodaki dosyaya dokunulmaz).
 * Sayfa/JS dosyalari ayni kalir: yalniz paket, manifest, on onbellek listesi ve SW damgasi degisir.
 */
export function yeniModelSurumu(kaynak: string, hedef: string, tmp: string): ModelSurumu {
  const kok = path.join(tmp, "model-kopya");
  const kopyalanacak = [
    "simulasyon/arayuz/server/oyun_server",
    "simulasyon/arayuz/server/bench",
    "simulasyon/arayuz/registry",
    "simulasyon/kagit-ustu/modulerlestirme/simkit",
    "simulasyon/kagit-ustu/modulerlestirme/simbuild.py",
    "simulasyon/kagit-ustu/modulerlestirme/model_mod.py",
  ];
  for (const g of kopyalanacak) cpSync(path.join(REPO, g), path.join(kok, g), { recursive: true, filter: (k) => !k.includes("__pycache__") && !k.endsWith(".pyc") });
  const hedefDosya = path.join(kok, "simulasyon/kagit-ustu/modulerlestirme/simkit/__init__.py");
  writeFileSync(hedefDosya, `${readFileSync(hedefDosya, "utf-8")}\n# b7-e2e: zararsiz yorum (yeni model anahtari)\n`);
  const paket = path.join(tmp, "paket2");
  execFileSync("node", ["scripts/paketModel.mjs", "--kok", kok, "--cikis", paket], { cwd: WEB, stdio: "pipe" });
  rmSync(hedef, { recursive: true, force: true });
  cpSync(kaynak, hedef, { recursive: true });
  for (const f of readdirSync(path.join(hedef, "oyun"))) if (/^oyun-[0-9a-f]{12}\.zip$/.test(f) || f === "manifest.json") rmSync(path.join(hedef, "oyun", f));
  for (const f of readdirSync(paket)) cpSync(path.join(paket, f), path.join(hedef, "oyun", f));
  execFileSync("node", ["scripts/onbellekListesi.mjs", "--out", hedef], { cwd: WEB, stdio: "pipe", env: { ...process.env, NEXT_PUBLIC_OYUN_KAYNAK: "tarayici" } });
  return manifestOku(hedef);
}

function kapiAcik(port: number): Promise<boolean> {
  return new Promise((coz) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), coz(true)));
    s.once("error", () => coz(false));
  });
}

/** Yerel `wrangler dev` (Cloudflare Workers statik varliklari): istekler gunlukten sayilir. */
export class Sunucu {
  readonly gunluk: string[] = [];
  private constructor(
    private readonly sur: ChildProcess,
    readonly port: number,
  ) {}

  static async baslat(dizin: string, port: number, tmp: string): Promise<Sunucu> {
    const cfg = path.join(tmp, `wrangler-${port}.jsonc`);
    writeFileSync(cfg, JSON.stringify({ name: "oyun-sw-e2e", compatibility_date: "2026-11-17", assets: { directory: dizin, not_found_handling: "404-page", html_handling: "auto-trailing-slash" } }));
    const cwd = path.join(tmp, "wrangler-calisma");
    mkdirSync(cwd, { recursive: true });
    const sur = spawn("npx", ["--yes", "wrangler@4.163.0", "dev", "--config", cfg, "--port", String(port), "--ip", "127.0.0.1"], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const s = new Sunucu(sur, port);
    const topla = (b: Buffer): void => void s.gunluk.push(...b.toString().replace(/\u001b\[[0-9;]*m/g, "").split("\n").filter(Boolean));
    sur.stdout?.on("data", topla);
    sur.stderr?.on("data", topla);
    const son = Date.now() + 120_000;
    while (!s.gunluk.some((l) => l.includes("Ready on"))) {
      if (Date.now() > son || sur.exitCode !== null) throw new Error(`wrangler dev baslamadi:\n${s.gunluk.slice(-15).join("\n")}`);
      await new Promise((c) => setTimeout(c, 200));
    }
    return s;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Gunluk konumu isareti (sonraki sayac/istekler bu konumdan sonrasini sayar). */
  isaret(): number {
    return this.gunluk.length;
  }

  /** `GET <yol> <durum>` satirlari (isaretten sonra). */
  istekler(sonra = 0): { yol: string; durum: number }[] {
    const out: { yol: string; durum: number }[] = [];
    for (const l of this.gunluk.slice(sonra)) {
      const m = /\bGET (\S+) (\d{3})\b/.exec(l);
      if (m) out.push({ yol: m[1] as string, durum: Number(m[2]) });
    }
    return out;
  }

  sayac(desen: RegExp, sonra = 0): number {
    return this.istekler(sonra).filter((i) => desen.test(i.yol)).length;
  }

  async durdur(): Promise<void> {
    const pid = this.sur.pid;
    if (pid !== undefined && this.sur.exitCode === null) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // zaten bitti
      }
    }
    const son = Date.now() + 15_000;
    while (Date.now() < son && (await kapiAcik(this.port))) await new Promise((c) => setTimeout(c, 200));
    if (pid !== undefined && (await kapiAcik(this.port))) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // bitti
      }
    }
  }
}
