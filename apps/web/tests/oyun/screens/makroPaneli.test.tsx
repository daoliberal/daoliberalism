import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { MakroBlogu, WeekPacket } from "@/oyun/sim/types";
import { ayrintilarHazir, mountCanli, state, week } from "../helpers/canliMount";
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

const makro = (w: number, over: { konut?: null; enfNull?: boolean } = {}): MakroBlogu => ({
  fiyat: { tuk: 1 + 0.1 * w, enf: over.enfNull ? null : 0.1234, uretici: 1 + 0.05 * w, ucret: 1 + 0.2 * w, gercek_ucret: 0.9 + 0.01 * w },
  uretim: { nominal: 320000, gercek: 300000 + 1000 * w, buyume: -0.05, verimlilik: 81.25 },
  para: { stok: 450000, korunum: 0, mali: 440000, kredi_net: 0, acilis: 10000, hiz: 0.4 },
  faiz: { politika: 0.156, mevduat: 0.08, kredi: 0.2, gercek: -0.0674 },
  marj: { npc: 0.05, oyuncu: -0.02 },
  konut: over.konut === null ? null : { kira: 1.5, kira_gelir: 0.12 },
  dagilim: { gini_nakit: 0.433, gini_gelir: 0.134, gini_servet: 0.551, yoksul: 0.807, medyan_sepet: 0.7 },
  kredi: { stok: 38120, buyume: 0.2, temerrut: 0.01 },
});
const paket = (w: number, m?: MakroBlogu): WeekPacket => ({ ...packet(w), world: { ...packet(w).world, unemployment_rate_all: 0.2 }, ...(m ? { makro: m } : {}) });
const senaryo = (f: (w: number) => MakroBlogu | undefined) => [state(), ...[1, 2, 3].map((w) => week(paket(w, f(w))))];
const kart = (id: string) => document.querySelector(`[data-makro="${id}"]`) as HTMLElement;
const ek = (id: string) => document.querySelector(`[data-makro-ek="${id}"]`) as HTMLElement;
const hazir = () => ayrintilarHazir(t("ayrintilar.sekme.makro"));

describe("M10 Makro göstergeler sekmesi", () => {
  it("test_sekme_sekiz_kart_deger_ve_aciklama", async () => {
    mountCanli(senaryo((w) => makro(w)));
    const pencere = await hazir();
    expect(within(pencere).getByRole("region", { name: t("makro.baslik") })).toBeInTheDocument();
    expect(kart("enflasyon").textContent).toContain("%12,3");
    expect(kart("gercek_ucret").textContent).toContain("93,0");                    // 0,93 x 100
    expect(kart("buyume").textContent).toContain("%-5,0");                         // negatif değer korunur
    expect(kart("issizlik").textContent).toContain("%20,0");
    expect(kart("politika").textContent).toContain("%15,6");
    expect(kart("gercek_faiz").textContent).toContain("%-6,7");
    expect(kart("gini").textContent).toContain("0,43");
    expect(kart("yoksul").textContent).toContain("%80,7");
    for (const id of ["enflasyon", "gercek_ucret", "buyume", "issizlik", "politika", "gercek_faiz", "gini", "yoksul"]) {
      expect(kart(id).textContent, id).toContain(t(`makro.kart.${id}.not` as Parameters<typeof t>[0]));     // her kartta açıklama (ne demek, iyi yönü)
    }
  });

  it("test_gruplu_grafikler_ve_seri_sayilari", async () => {
    mountCanli(senaryo((w) => makro(w)));
    const pencere = await hazir();
    for (const g of ["fiyat", "uretim", "faiz", "dagilim", "kredi", "firma"] as const) expect(within(pencere).getByRole("heading", { name: t(`makro.grup.${g}`) })).toBeInTheDocument();
    const fiyat = within(pencere).getByRole("img", { name: t("makro.grafik.fiyat") });
    for (const s of ["tuketici", "uretici", "ucret", "gercek-ucret"]) expect(fiyat.querySelectorAll(`[data-seri="${s}"]`).length, s).toBe(1);
    for (const k of ["uretim", "para", "hiz", "faiz", "faiz2", "gini", "yoksul", "kredi", "kredi_oran", "marj", "verimlilik", "kira"] as const) {
      expect(within(pencere).getByRole("img", { name: t(`makro.grafik.${k}` as Parameters<typeof t>[0]) }), k).toBeInTheDocument();
    }
  });

  it("test_ayrintili_gostergeler_ve_para_kalemleri", async () => {
    mountCanli(senaryo((w) => makro(w)));
    await hazir();
    expect(ek("tuketici").textContent).toContain("130,0");                         // 1,3 x 100
    expect(ek("para_stok").textContent).toContain("450.000");
    expect(ek("para_mali").textContent).toContain("440.000");
    expect(ek("para_acilis").textContent).toContain("10.000");
    expect(ek("marj_oyuncu").textContent).toContain("%-2,0");
    expect(ek("istihdam").textContent).toContain("%80,0");                         // 1 - işsizlik
    expect(ek("kira").textContent).toContain("150,0");
  });

  it("test_olculmeyen_deger_olculmuyor_yazar_konut_kapaliysa_kira_grafigi_yok", async () => {
    mountCanli(senaryo((w) => makro(w, { enfNull: true, konut: null })));
    const pencere = await hazir();
    expect(kart("enflasyon").textContent).toContain(t("canli.gosterge.olculmuyor"));
    expect(ek("kira").textContent).toContain(t("canli.gosterge.olculmuyor"));
    expect(within(pencere).queryByRole("img", { name: t("makro.grafik.kira") })).toBeNull();
    expect(pencere.textContent).not.toMatch(/NaN|undefined/);
  });

  it("test_blok_yoksa_eski_sunucu_notu", async () => {
    mountCanli(senaryo(() => undefined));
    const pencere = await hazir();
    expect(within(pencere).getByText(t("makro.eski_sunucu"))).toBeInTheDocument();
    expect(document.querySelector("[data-makro]")).toBeNull();
  });

  it("test_ic_jargon_gorunmez_ve_sehir_secimi_yok", async () => {
    mountCanli(senaryo((w) => makro(w)));
    const pencere = await hazir();
    expect(pencere.textContent).not.toMatch(/\bWI\b|\bcpi\b|\bpidx\b|_cum|\bW\./i);
    expect(within(pencere).queryByRole("group", { name: t("ayrintilar.kapsam") })).toBeNull();   // dünya düzeyi: kapsam seçicisi bu sekmede yok
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("tab", { name: t("ayrintilar.sekme.genel") }));
  });
});
