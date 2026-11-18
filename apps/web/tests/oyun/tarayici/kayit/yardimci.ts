import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { CekirdekHatasi, type DevamGirdisi, type KayitCekirdegi, type TariftenGirdisi } from "@/oyun/tarayici/kayit/cekirdek";
import { KayitDeposu } from "@/oyun/tarayici/kayit/depo";
import { TEL_SEMA, type DevamSonuc, type GoruntuAlSonuc, type GunlukGirisi, type HaftaPaketi, type ModelAnahtari, type Tarif, type Yonetici } from "@/oyun/tarayici/kayit/tel";
import type { SemaTuru } from "@/oyun/tarayici/kayit/sema";

export const ANAHTAR: ModelAnahtari = { model_sha256: "a".repeat(64), pyodide: "0.27.7", schema: 2, host_sema: 1 };

export function yeniIdb(): IDBFactory {
  return new IDBFactory();
}

export async function yeniDepo(idb: IDBFactory = yeniIdb(), zaman?: () => number): Promise<KayitDeposu> {
  return KayitDeposu.ac(idb, { zaman });
}

/** Sema tur dizgelerinden en basit gecerli ornek (ilk secenek; `null` yalniz tek secenekse). */
export function ornekDeger(s: SemaTuru): unknown {
  if (typeof s === "string") {
    const t = s.split("|")[0] as string;
    return { int: 0, num: 0, str: "", bool: false, null: null, dict: {}, list: [] }[t];
  }
  if (Array.isArray(s)) return [];
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, SemaTuru>)) if (!k.endsWith("?")) o[k] = ornekDeger(v);
  return o;
}

export function tarifOrnek(ek: Partial<Tarif> = {}): Tarif {
  return { config: { oyun: "deneme" }, takvim: [], parent_id: null, fork_week: null, dunya_kodu: null, oyuncu: null, ...ek };
}

export function karar(sira: number, dikis: number, ek: Record<string, unknown> = {}): GunlukGirisi {
  return { sira, tur: "karar", dikis, karar: { alan: "x" + sira, ...ek } };
}
export function sart(sira: number, dikis: number): GunlukGirisi {
  return { sira, tur: "sart", dikis, yama: { a: sira }, not: null, surum: sira + 1 };
}

interface KosuDurumu {
  id: string;
  tarif: Tarif;
  released: number;
  host: number;
  gunluk: GunlukGirisi[];
  sonGoruntu: number;
  ham: number;
  /** Kurucu (lookahead): host yayimdan bu kadar ileride kosar. */
  onde: number;
}

export interface CekirdekCagrisi {
  yontem: string;
  girdi: Record<string, unknown>;
}

/**
 * Sahte cekirdek: B4a API'sinin sozlesmeye uygun, deterministik taklidi. Goruntu = `{anahtar, durum}` JSON'u (3 parca); `devam` yalniz anahtari,
 * isaretci metinleri (`GUVENSIZ`, `BOZUK`) ve ValueError kosullarini denetler. Uretilen her sonuc `tel_b4.json` semasina uygun olmalidir (tel.test.ts).
 */
export class SahteCekirdek implements KayitCekirdegi {
  anahtar: ModelAnahtari = { ...ANAHTAR };
  kosular = new Map<string, KosuDurumu>();
  cagrilar: CekirdekCagrisi[] = [];
  gorulenGoruntu = 0;
  goruntuHatasi: { tur: string; kac: number } | null = null;
  parcaVer = 3;
  tutarsizKimlik = false;
  /** `devam`/`tariftenOynat`: bu `sira`da reddedilir. */
  reddet: number | null = null;
  kadans = 13;

  // ---- test yardimcilari ----
  kosuYarat(id: string, tarif: Tarif = tarifOrnek()): void {
    this.kosular.set(id, { id, tarif, released: 0, host: 0, gunluk: [], sonGoruntu: 0, ham: 1000, onde: 0 });
  }

  /** Bir hafta ilerler (host = released) ve paketi dondurur. */
  tick(id: string): HaftaPaketi {
    const k = this.kosular.get(id) as KosuDurumu;
    k.released += 1;
    k.host = k.released + k.onde;
    return { week: k.released, run_id: id, deger: k.released * 7 };
  }

  gunlugeEkle(id: string, g: GunlukGirisi): void {
    (this.kosular.get(id) as KosuDurumu).gunluk.push(g);
  }

  private yonetici(k: KosuDurumu, kimlik: string): Yonetici {
    const y = ornekDeger(TEL_SEMA.yonetici) as Yonetici;
    return { ...y, sema: 1, goruntu_kimligi: kimlik, id: k.id, released: k.released, worker_week: k.host, target: k.released, gunluk_sira: k.gunluk.length, parent_id: k.tarif.parent_id, fork_week: k.tarif.fork_week, mode: "dao", name: "oyun", scenario_id: "s", status: "paused", son_ham: k.ham };
  }

  // ---- KayitCekirdegi ----
  async uyumlulukAnahtari(): Promise<ModelAnahtari> {
    return { ...this.anahtar };
  }
  async goruntuGerekli(id: string): Promise<boolean> {
    const k = this.kosular.get(id) as KosuDurumu;
    return k.released - k.sonGoruntu >= this.kadans;
  }
  async goruntuAl(id: string, sink: (p: Uint8Array) => void): Promise<GoruntuAlSonuc> {
    this.cagrilar.push({ yontem: "goruntuAl", girdi: { id } });
    const k = this.kosular.get(id) as KosuDurumu;
    // Hata, bazi parcalar verildikten sonra gelebilir (tel_b4: gelen parcalar atilir).
    if (this.goruntuHatasi && this.goruntuHatasi.kac > 0) {
      this.goruntuHatasi.kac--;
      sink(new Uint8Array([1, 2, 3]));
      throw new CekirdekHatasi(this.goruntuHatasi.tur, "goruntu_hatasi");
    }
    const kimlik = "g" + (++this.gorulenGoruntu).toString(16).padStart(8, "0");
    const govde = new TextEncoder().encode(JSON.stringify({ anahtar: this.anahtar, id, released: k.released, host: k.host, k: kimlik }));
    const n = this.parcaVer;
    const boy = Math.ceil(govde.length / n);
    let verilen = 0;
    for (let i = 0; i < n; i++) {
      const dilim = govde.slice(i * boy, (i + 1) * boy);
      if (dilim.length === 0) continue;
      // Arabellek yeniden kullanimi: sink cagrisindan sonra baytlar degisebilir; kopya alinmazsa yazilan goruntu bozulur.
      const tampon = new Uint8Array(dilim.length + 8);
      tampon.set(dilim, 4);
      const gorunum = tampon.subarray(4, 4 + dilim.length);
      sink(gorunum);
      tampon.fill(0);
      verilen++;
    }
    k.sonGoruntu = k.released;
    const y = this.yonetici(k, this.tutarsizKimlik ? "baska" : kimlik);
    return { hafta: k.host, yayimlanan: k.released, goruntu_kimligi: kimlik, ham: k.ham, sikisik: govde.length, parca: verilen, anahtar: { ...this.anahtar }, gunluk_sira: k.gunluk.length, yonetici: y };
  }
  async gunlukAl(id: string, sonra: number): Promise<GunlukGirisi[]> {
    return (this.kosular.get(id) as KosuDurumu).gunluk.filter((g) => g.sira > sonra).map((g) => structuredClone(g));
  }
  async tarifAl(id: string): Promise<Tarif> {
    return structuredClone((this.kosular.get(id) as KosuDurumu).tarif);
  }

  private oynat(k: KosuDurumu, gunluk: GunlukGirisi[], hedef: number, ilerleme?: (h: number) => void): DevamSonuc {
    const baslangic = k.released;
    let beklenen = k.gunluk.length + 1;
    for (const g of gunluk.filter((x) => x.sira > k.gunluk.length)) {
      if (g.dikis > hedef) break;
      if (g.sira !== beklenen) return { durum: "sapma", kosu_id: k.id, hafta: k.released, uygulanan: k.released - baslangic, kalan: hedef - k.released, neden: "sira", beklenen, gercek: g.sira };
      if (this.reddet === g.sira) return { durum: "reddedildi", kosu_id: k.id, hafta: g.dikis, uygulanan: g.dikis - baslangic, kalan: hedef - g.dikis, giris: g as unknown as Record<string, unknown>, neden: "reddedildi", fields: [] };
      k.gunluk.push(structuredClone(g));
      beklenen++;
    }
    for (let h = baslangic + 1; h <= hedef; h++) {
      k.released = h;
      k.host = h;
      ilerleme?.(h);
    }
    return { durum: "tamam", kosu_id: k.id, hafta: k.released, uygulanan: hedef - baslangic, kalan: 0 };
  }

  async devam(g: DevamGirdisi): Promise<DevamSonuc> {
    const govde = new TextDecoder().decode(await birlestir(g.goruntu.parcalar));
    this.cagrilar.push({ yontem: "devam", girdi: { goruntuBayt: g.goruntu.parcalar.reduce((a, p) => a + p.byteLength, 0), parcaSayisi: g.goruntu.parcalar.length, govde, gunlukSiralari: g.gunluk.map((x) => x.sira), paketHaftalari: (g.paketler ?? []).map((p) => p.week), hedef: g.hedefHafta, kosuId: g.kosuId ?? null, ebeveyn: g.ebeveyn ?? null, azami: g.azamiHafta ?? null } });
    if (govde.includes("GUVENSIZ")) throw new CekirdekHatasi("GuvensizGoruntu", "guvensiz", { guvensiz: ["os", "system"] });
    if (govde.includes("BOZUK") || !govde.startsWith("{")) throw new CekirdekHatasi("UyumsuzGoruntu", "bozuk", { bozuk: ["EOFError", "kesik"] });
    const ic = JSON.parse(govde) as { anahtar: ModelAnahtari };
    const fark: Record<string, unknown> = {};
    for (const a of Object.keys(this.anahtar) as (keyof ModelAnahtari)[]) if (ic.anahtar[a] !== this.anahtar[a]) fark[a] = [ic.anahtar[a], this.anahtar[a]];
    if (Object.keys(fark).length) throw new CekirdekHatasi("UyumsuzGoruntu", "uyumsuz", fark);
    const y = g.goruntu.yonetici;
    if (g.ebeveyn && !(y.worker_week <= g.hedefHafta && g.hedefHafta === g.ebeveyn[1])) throw new CekirdekHatasi("ValueError", "dal_goruntu_ileride");
    if (g.hedefHafta < y.released) throw new CekirdekHatasi("ValueError", "hedef_yayimlanandan_once");
    if (g.azamiHafta != null && g.hedefHafta - y.released > g.azamiHafta) throw new CekirdekHatasi("ValueError", "devam_cok_uzun");
    const id = g.kosuId ?? y.id;
    if (this.kosular.has(id)) throw new CekirdekHatasi("ValueError", "var_olan_kosu");
    const tarif = tarifOrnek({ parent_id: g.ebeveyn?.[0] ?? y.parent_id, fork_week: g.ebeveyn?.[1] ?? y.fork_week });
    const k: KosuDurumu = { id, tarif, released: y.released, host: y.worker_week, gunluk: [], sonGoruntu: y.released, ham: 1000, onde: 0 };
    // Goruntu oncesi girisler (sira <= gunluk_sira) kosunun kendi gunlugudur.
    k.gunluk = g.gunluk.filter((x) => x.sira <= y.gunluk_sira).map((x) => structuredClone(x));
    this.kosular.set(id, k);
    return this.oynat(k, g.gunluk, g.hedefHafta, g.ilerleme);
  }

  async tariftenOynat(g: TariftenGirdisi): Promise<DevamSonuc> {
    this.cagrilar.push({ yontem: "tariftenOynat", girdi: { gunlukSiralari: g.gunluk.map((x) => x.sira), hedef: g.hedefHafta, kosuId: g.kosuId ?? null, tarif: g.tarif, azami: g.azamiHafta ?? null } });
    const id = g.kosuId ?? "uretilen";
    if (this.kosular.has(id)) throw new CekirdekHatasi("ValueError", "var_olan_kosu");
    const k: KosuDurumu = { id, tarif: structuredClone(g.tarif), released: 0, host: 0, gunluk: [], sonGoruntu: 0, ham: 1000, onde: 0 };
    this.kosular.set(id, k);
    return this.oynat(k, g.gunluk, g.hedefHafta, g.ilerleme);
  }

  async kosuSil(id: string): Promise<void> {
    this.cagrilar.push({ yontem: "kosuSil", girdi: { id } });
    this.kosular.delete(id);
  }
}

export async function birlestir(parcalar: ArrayBuffer[]): Promise<Uint8Array> {
  const toplam = parcalar.reduce((a, p) => a + p.byteLength, 0);
  const o = new Uint8Array(toplam);
  let i = 0;
  for (const p of parcalar) {
    o.set(new Uint8Array(p), i);
    i += p.byteLength;
  }
  return o;
}

export async function kosuyuKur(c: SahteCekirdek, id: string, hafta: number, olay?: (h: number, paket: HaftaPaketi) => Promise<void>): Promise<void> {
  c.kosuYarat(id);
  for (let h = 1; h <= hafta; h++) {
    const p = c.tick(id);
    await olay?.(h, p);
  }
}
