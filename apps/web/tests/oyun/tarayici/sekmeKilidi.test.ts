// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sekmeKilidiAl, type KilitYuzu, type SekmeOrtami } from "@/oyun/tarayici/sekmeKilidi";
import { SahteKilitler, SahteYayin } from "./yardimci";

const bekleme = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.min(ms, 20)));
const ort = (locks: KilitYuzu | null, yayin: SahteYayin | null): SekmeOrtami => ({ locks, kanalUret: yayin ? yayin.uret : null, bekle: bekleme });

describe("sekmeKilidiAl: navigator.locks", () => {
  it("kilit_bos_alindi_ikinci_sekme_dolu_Worker_baslatilmaz_karari_cagirana_kalir", async () => {
    const locks = new SahteKilitler();
    const a = await sekmeKilidiAl(ort(locks, null));
    expect(a.durum).toBe("alindi");
    const b = await sekmeKilidiAl(ort(locks, null));
    expect(b.durum).toBe("dolu");
    if (a.durum === "alindi") a.birak();
    await Promise.resolve();
    expect(locks.dolu).toBe(false);
  });

  it("devral_zarif_yol_ilk_sekme_devir_isleyicisini_calistirir_kilidi_birakir_ikinci_alir", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    const a = await sekmeKilidiAl(ort(locks, yayin));
    const olaylar: string[] = [];
    if (a.durum !== "alindi") throw new Error("alinmadi");
    a.devirDinle(async () => void olaylar.push("a_kapatiliyor"));
    void a.devredildi.then(() => olaylar.push("a_devredildi"));
    const b = await sekmeKilidiAl(ort(locks, yayin));
    if (b.durum !== "dolu") throw new Error("dolu_degil");
    const bt = await b.devral();
    olaylar.push("b_aldi");
    expect(olaylar.slice(0, 1)).toEqual(["a_kapatiliyor"]);
    await a.devredildi;
    expect(olaylar).toContain("a_devredildi");
    expect(locks.dolu).toBe(true);                     // ikinci sekme tutuyor
    bt.birak();
  });

  it("devral_yedek_yol_ilk_sekme_yanit_vermezse_steal_ile_alinir_ilk_sekmenin_sozu_reddedilir", async () => {
    const locks = new SahteKilitler();
    const a = await sekmeKilidiAl(ort(locks, null));                     // kanal yok: zarif yol yok
    if (a.durum !== "alindi") throw new Error("alinmadi");
    let devredildi = false;
    void a.devredildi.then(() => (devredildi = true));
    const b = await sekmeKilidiAl(ort(locks, null));
    if (b.durum !== "dolu") throw new Error("dolu_degil");
    const bt = await b.devral();
    await a.devredildi;
    expect(devredildi).toBe(true);
    expect(bt.birak).toBeTypeOf("function");
  });
});

describe("sekmeKilidiAl: navigator.locks yoksa BroadcastChannel yedegi", () => {
  it("kimse_yoksa_alindi_biri_varsa_dolu_ve_devral_zarif_kapatir", async () => {
    const yayin = new SahteYayin();
    const a = await sekmeKilidiAl(ort(null, yayin));
    expect(a.durum).toBe("alindi");
    if (a.durum !== "alindi") return;
    let kapatildi = false;
    a.devirDinle(async () => void (kapatildi = true));
    const b = await sekmeKilidiAl(ort(null, yayin));
    expect(b.durum).toBe("dolu");
    if (b.durum !== "dolu") return;
    await b.devral();
    expect(kapatildi).toBe(true);
    await a.devredildi;
  });

  it("ne_locks_ne_kanal_korumasiz_devam", async () => {
    const s = await sekmeKilidiAl(ort(null, null));
    expect(s.durum).toBe("korumasiz");
  });
});

describe("devir onayi (Y1)", () => {
  it("eski_sekme_hemen_onaylar_yavas_bitirse_de_yeni_sekme_BITMEYI_bekler_kilit_calinmaz", async () => {
    const locks = new SahteKilitler();
    const yayin = new SahteYayin();
    const olcekli: SekmeOrtami = { locks, kanalUret: yayin.uret, bekle: (ms) => new Promise((r) => setTimeout(r, ms / 100)) };   // 1500 -> 15 ms, 20000 -> 200 ms
    const a = await sekmeKilidiAl(olcekli);
    if (a.durum !== "alindi") throw new Error("alinmadi");
    const sira: string[] = [];
    a.devirDinle(async () => {
      sira.push("a_basladi");
      await new Promise((r) => setTimeout(r, 90));                       // onay suresinden (15 ms) cok uzun
      sira.push("a_yazimlari_bitti");
    });
    const b = await sekmeKilidiAl(olcekli);
    if (b.durum !== "dolu") throw new Error("dolu_degil");
    const bt = await b.devral();
    sira.push("b_aldi");
    expect(sira).toEqual(["a_basladi", "a_yazimlari_bitti", "b_aldi"]);
    bt.birak();
  });
});
