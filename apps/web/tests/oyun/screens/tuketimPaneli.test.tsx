import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import type { DrawerData, EkonomiBlogu, EksikUrun, HaneTuketim, WeekPacket } from "@/oyun/sim/types";
import { ADLAR, ayrintilarHazir, mountCanli, state, week } from "../helpers/canliMount";
import { packet } from "../helpers/sehirZincirVeri";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const h = (n: number | null, karsilanma: number | null, sepet: number | null = 40): HaneTuketim => ({ n, karsilanma, sepet });
const URUNLER: EksikUrun[] = [
  { urun: "un", istek: 5000, karsilanmayan: 500, uretim: 4000, stok: 120 },
  { urun: "ekmek", istek: 4800, karsilanmayan: 1440, uretim: 3000, stok: 1234 },
  { urun: "kumas", istek: 1000, karsilanmayan: 100, uretim: 900, stok: 5 },
  { urun: "giysi", istek: 900, karsilanmayan: 180, uretim: 500, stok: 7 },
  { urun: "bugday", istek: 3000, karsilanmayan: 30, uretim: 3100, stok: 90 },
];
const sehirSatiri = (i: number) => ({
  sehir: i, ise: h(100, i === 1 ? 0.9 : 0.8), issiz: h(10, 0.5), npc: { ise: h(100, i === 1 ? 0.5 : 0.6), issiz: h(10, 0.3), dis: h(0, null) },
  npc_issiz_parasiz: 10 + i, harcama: { oyuncu: 1000 + i, npc: 5000 + i },
});

/** Oyuncu ise 0,8 (n 700), yerleşik ise 0,65 (n 2100) -> birleşik %69; iş arayan 0,5 (70) ve 0,37 (210) -> %40. */
const eko = (w: number, over: { karsilanmaNull?: boolean; urunler?: EksikUrun[] | null } = {}): EkonomiBlogu => ({
  tuketim: {
    hane: {
      ise: h(700, over.karsilanmaNull ? null : 0.8 - w * 0.001), issiz: h(70, 0.5),
      npc: { ise: h(2100, over.karsilanmaNull ? null : 0.65), issiz: h(210, 0.37), dis: h(0, null) },
      npc_issiz_parasiz: 120.4, sehir: [0, 1, 2, 3, 4].map(sehirSatiri),
    },
    harcama: { npc: 402503, oyuncu: 100503, toplam: 503006 },
    urunler: over.urunler === undefined ? URUNLER : over.urunler,
    ucret: {
      dunya: { ucret: 1 + 0.1 * w, fiyat: 1 + 0.2 * w, net: 75, oran: 1.25 },
      sehir: [0, 1, 2, 3, 4].map(() => ({ ucret: 1 + 0.1 * w, fiyat: 1 + 0.5 * w, net: 80, oran: 1.6 })),
    },
  },
  isletme: { istihdam: { oyuncu: null, npc: null, ozel: null, kamu: null }, hareket: null, sektor: [], sektor_diger: null, sehir: [] },
  para: null,
});
const paket = (w: number, e?: EkonomiBlogu): WeekPacket => ({ ...packet(w), ...(e ? { ekonomi: e } : {}) });
const senaryo = (over: Parameters<typeof eko>[1] = {}, ekonomiVar = true) => [state(), ...[1, 2, 3].map((w) => week(paket(w, ekonomiVar ? eko(w, w === 1 ? { ...over } : over) : undefined)))];
const sehirDrawer = (w: number): DrawerData => ({
  kind: "urun", ref: "un", week: w, stale: false, title: "Un",
  fields: { urun: "un", istek: 1, karsilanmayan: 1, uretim: 1, stok: 1, sehirler: [0, 1, 2, 3, 4].map((s) => ({ sehir: s, talep: 20 + s, uretim: 18 + s, stok: 5 + s, firma: 2 + s, saglikli: 1 })) },
});
const olcu = (id: string) => document.querySelector(`[data-tuketim="${id}"]`) as HTMLElement;
const hazir = () => ayrintilarHazir("Tüketim");

describe("M10 Tüketim sekmesi", () => {
  it("test_tuketim_sekmesi_karsilanma_ve_harcama_grafikleri", async () => {
    mountCanli(senaryo());
    const pencere = await hazir();
    expect(within(pencere).getByRole("img", { name: t("tuketim.karsilanma.grafik", { grup: t("tuketim.karsilanma.ise") }) })).toBeInTheDocument();
    expect(within(pencere).getByRole("img", { name: t("tuketim.karsilanma.grafik", { grup: t("tuketim.karsilanma.issiz") }) })).toBeInTheDocument();
    expect(within(pencere).getByRole("img", { name: t("tuketim.harcama.baslik") })).toBeInTheDocument();
    expect(within(pencere).getByRole("img", { name: t("tuketim.sepet.baslik") })).toBeInTheDocument();
    expect(olcu("karsilanma_ise").textContent).toContain("%69");
    expect(olcu("karsilanma_issiz").textContent).toContain("%40");
    expect(olcu("karsilanma_ise").textContent).toContain(t("tuketim.kisi", { n: 400 }));  // 2800 kişi-döngü / 7
    expect(olcu("kapsam").textContent).toBe(t("tuketim.dunya_rozeti"));
    expect(olcu("parasiz").textContent).toContain(t("tuketim.kisi", { n: 120 }));          // kişi-hafta olduğu gibi, 7'ye bölünmez
    expect(olcu("harcama_npc").textContent).toContain("402.503");
    expect(olcu("harcama_oyuncu").textContent).toContain("100.503");
    expect(pencere.querySelectorAll('[data-seri="ise-birlesik"]').length).toBe(1);
  });

  it("test_ucret_ve_fiyat_bolumu_dunya_ve_sehir", async () => {
    mountCanli(senaryo());
    const pencere = await hazir();
    expect(within(pencere).getByRole("heading", { name: t("tuketim.ucret.baslik") })).toBeInTheDocument();
    expect(olcu("ucret_endeksi").textContent).toContain("118,2");                               // 1,3 / 1,1 (ilk hafta = 100)
    expect(olcu("fiyat_endeksi").textContent).toContain("133,3");                               // 1,6 / 1,2
    expect(olcu("net_ucret").textContent).toContain("75,0");
    expect(olcu("sepet_bedeli").textContent).toContain("60,0");                                 // tam sepet = net / oran = 75 / 1,25 (hanelerin fiilen aldığı sepet değil)
    expect(olcu("sepet_bedeli").textContent).not.toContain("40,0");
    expect(olcu("sepet_bedeli").closest("dl")!.textContent).toContain(t("tuketim.ucret.sepet"));
    expect(olcu("ucret_orani").textContent).toContain("1,25 katı");
    const grafik = within(pencere).getByRole("img", { name: t("tuketim.ucret.grafik") });
    expect(grafik.querySelectorAll('[data-seri="ucret-endeksi"]').length).toBe(1);
    expect(grafik.querySelectorAll('[data-seri="fiyat-endeksi"]').length).toBe(1);
    expect(pencere.textContent).not.toMatch(/\bWI\b|\bcpi\b/i);
    fireEvent.click(within(pencere).getByRole("button", { name: cityDisplayName(ADLAR[1]!, 1) }));
    await waitFor(() => expect(olcu("fiyat_endeksi").textContent).toContain("166,7"));         // şehir: 2,5 / 1,5
    expect(olcu("ucret_orani").textContent).toContain("1,60 katı");
    expect(olcu("net_ucret").textContent).toContain("80,0");
    expect(olcu("sepet_bedeli").textContent).toContain("50,0");                                 // 80 / 1,6
  });

  it("test_ucret_alani_yoksa_bolum_gorunmez", async () => {
    const eski = (w: number): EkonomiBlogu => { const e = eko(w); return { ...e, tuketim: { ...e.tuketim, ucret: undefined } }; };
    mountCanli([state(), ...[1, 2, 3].map((w) => week(paket(w, eski(w))))]);
    const pencere = await hazir();
    expect(olcu("karsilanma_ise")).toBeTruthy();
    expect(pencere.querySelector('[data-tuketim="ucret_endeksi"]')).toBeNull();
    expect(within(pencere).queryByRole("heading", { name: t("tuketim.ucret.baslik") })).toBeNull();
  });

  it("test_sehir_secilince_sehir_karsilanma_ve_dunya_rozeti", async () => {
    mountCanli(senaryo());
    const pencere = await hazir();
    fireEvent.click(within(pencere).getByRole("button", { name: cityDisplayName(ADLAR[1]!, 1) }));
    const ad = cityDisplayName(ADLAR[1]!, 1);
    await waitFor(() => expect(olcu("sehir_karsilanma")).toBeTruthy());
    expect(olcu("sehir_karsilanma").textContent).toBe(`${t("tuketim.sehir_karsilanma", { ad })}: %80`);   // cities[1].served (0,797)
    expect(within(pencere).getAllByText(t("tuketim.sehir_karsilanma.aciklama")).length).toBeGreaterThan(0);   // iki karşılanma ölçüsünün farkı yazılı
    expect(within(pencere).getByText(t("tuketim.hane.aciklama"))).toBeInTheDocument();
    expect(olcu("kapsam").textContent).toBe(t("tuketim.sehir_rozeti", { ad }));
    expect(olcu("karsilanma_ise").textContent).toContain("%70");                                         // şehir 1: (100*0,9 + 100*0,5) / 200
    expect(olcu("parasiz").textContent).toContain(t("tuketim.kisi", { n: 11 }));
    expect(olcu("harcama_npc").textContent).toContain("5.001");
    expect(olcu("eksik_kapsam").textContent).toBe(t("tuketim.dunya_rozeti"));                           // ürün listesi her zaman tüm dünya
  });

  it("test_en_cok_eksik_urunler_tablosu", async () => {
    mountCanli(senaryo());
    const pencere = await hazir();
    const bolum = within(pencere).getByRole("region", { name: t("tuketim.eksik.baslik") });
    const tablo = within(bolum).getByRole("table");
    const satirlar = within(tablo).getAllByRole("row").slice(1);
    expect(satirlar).toHaveLength(5);
    expect(satirlar[0]!.textContent).toContain("Ekmek");                                               // 1440 / 4800 = %30 en yüksek (giysi %20)
    expect(satirlar[0]!.textContent).toContain("1.234");                                               // stok, sayi biçimi
    expect(satirlar[0]!.textContent).toContain("%30");
    expect(satirlar[4]!.textContent).toContain("Buğday");
    for (const b of [t("tuketim.eksik.urun"), t("tuketim.eksik.istek"), t("tuketim.eksik.karsilanmayan"), t("tuketim.eksik.uretim"), t("tuketim.eksik.stok")]) expect(within(tablo).getAllByText(b).length).toBeGreaterThan(0);
  });

  it("test_urune_tiklayinca_cekmece_ayrintisi", async () => {
    const drawer = vi.fn(async (_r: string, _k: string, _ref: string, w: number) => sehirDrawer(w));
    mountCanli(senaryo(), { drawer });
    const pencere = await hazir();
    fireEvent.click(within(pencere).getByRole("button", { name: "Un" }));
    expect(drawer).toHaveBeenCalledWith("r", "urun", "un", 3);
    const bolum = await within(pencere).findByRole("region", { name: t("tuketim.urun.baslik", { urun: "Un" }) });
    await waitFor(() => expect(within(within(bolum).getByRole("table")).getAllByRole("row")).toHaveLength(6));
    expect(bolum.textContent).toContain(cityDisplayName(ADLAR[4]!, 4));
    fireEvent.click(within(bolum).getByRole("button", { name: t("tuketim.urun.kapat") }));
    expect(within(pencere).queryByRole("region", { name: t("tuketim.urun.baslik", { urun: "Un" }) })).toBeNull();
  });

  it("test_urun_cekmecesi_reddedilirse_yok_metni_panel_cokmez", async () => {
    mountCanli(senaryo(), { drawer: async () => { throw new SimUnsupported("invalid_drawer"); } });
    const pencere = await hazir();
    fireEvent.click(within(pencere).getByRole("button", { name: "Un" }));
    expect(await within(pencere).findByText(t("tuketim.urun.yok"))).toBeInTheDocument();
    expect(within(pencere).getByRole("region", { name: t("tuketim.baslik") })).toBeInTheDocument();
  });

  it("test_urun_404_hata_degil_duraklatinca_acilir_metni", async () => {
    mountCanli(senaryo(), { drawer: async () => { throw new SimUnsupported("not_found"); } });
    const pencere = await hazir();
    fireEvent.click(within(pencere).getByRole("button", { name: "Un" }));
    expect(await within(pencere).findByText(t("tuketim.urun.yok_hafta"))).toBeInTheDocument();
    expect(within(pencere).queryByText(t("tuketim.urun.yok"))).toBeNull();
    expect(within(pencere).queryByRole("alert")).toBeNull();
  });

  it("test_ilk_hafta_ve_eksik_deger_olculmuyor", async () => {
    mountCanli([state(), ...[1, 2, 3].map((w) => week(paket(w, eko(w, { karsilanmaNull: true }))))]);
    await hazir();
    expect(olcu("karsilanma_ise").querySelector("dd")!.textContent).toBe(t("canli.gosterge.olculmuyor"));
    expect(olcu("karsilanma_ise").textContent).not.toContain("%0");
  });

  it("test_pano_kapali_urunler_null_mesaj_gosterir", async () => {
    mountCanli(senaryo({ urunler: null }));
    const pencere = await hazir();
    const bolum = within(pencere).getByRole("region", { name: t("tuketim.eksik.baslik") });
    expect(within(bolum).getByText(t("tuketim.olculmuyor_pano"))).toBeInTheDocument();
    expect(within(bolum).queryByRole("table")).toBeNull();
  });

  it("test_ekonomi_bloku_yok_eski_kayit", async () => {
    mountCanli(senaryo({}, false));
    const pencere = await hazir();
    expect(within(pencere).getByText(t("tuketim.eski_sunucu"))).toBeInTheDocument();
    fireEvent.click(within(pencere).getByRole("tab", { name: "Genel" }));
    expect(within(pencere).getByRole("tab", { name: "Genel", selected: true })).toBeInTheDocument();
  });
});
