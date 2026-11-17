import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { HaritaFirmaSatiri } from "@/oyun/harita/tipler";
import { IsletmeIsgucuPaneli } from "@/oyun/screens/canli/IsletmeIsgucuPaneli";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { CityRow, DrawerData, EkonomiBlogu, EkonomiSehir, Hareket, WeekPacket } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";
import { packet } from "../helpers/sehirZincirVeri";

afterEach(() => cleanup());

const ADLAR = ["Ada", "Bora", "Cem", "Dil", "Efe"];
const hr = (k: number): Hareket => ({ kurulan: k, buyuyen: 2 * k, kuculen: 3 * k, batan: 4 * k });
const sehirE = (i: number, boy: [number, number, number, number], hareket: Hareket | null): EkonomiSehir => ({
  sehir: i, ozel_calisan: 100 + i, kamu_calisan: 10 + i, calisan_oyuncu: 5 + i, calisan_npc: 95 + i, isgucu_disi: 20 + i, boy, hareket,
});
const BOYLAR: [number, number, number, number][] = [[12, 3, 1, 0], [12, 3, 1, 0], [12, 3, 1, 0], [12, 3, 1, 0], [12, 3, 1, 1]];
const eko = (w: number, over: { harcama?: number | null; hareket?: Hareket | null; ozel?: number | null; sektorSayisi?: number; diger?: boolean } = {}): EkonomiBlogu => ({
  tuketim: {
    hane: { ise: { n: 1, karsilanma: 1, sepet: 1 }, issiz: { n: 1, karsilanma: 1, sepet: 1 }, npc: null, npc_issiz_parasiz: null, sehir: [] },
    harcama: { npc: 0, oyuncu: 0, toplam: over.harcama === undefined ? 1000 * w : over.harcama }, urunler: null,
  },
  isletme: {
    istihdam: { oyuncu: 30, npc: 470, ozel: over.ozel === undefined ? 400 + 10 * w : over.ozel, kamu: 100 },
    hareket: over.hareket === undefined ? hr(1) : over.hareket,
    sektor: Array.from({ length: over.sektorSayisi ?? 12 }, (_, i) => ({ tur: `s${i}`, calisan: 50 - i, firma: 5 })),
    sektor_diger: over.diger === false ? null : { calisan: 7, firma: 3 },
    sehir: BOYLAR.map((b, i) => sehirE(i, b, hr(i + 1))),
  },
  para: null,
});
const sehirler = (): CityRow[] => [0, 1, 2, 3, 4].map((i) => ({
  index: i, served: 0.5, employed: 100, unemployed: 10, cash: 1, firms_npc: 1, firms_player: 0, rent_pct: null, occupancy: null, tenants_per_house: null,
  migration_in: 0, migration_out: 0, players_seeking: 2 + i, npc_pool: 10 * (i + 1),
}));
const paket = (w: number, e?: EkonomiBlogu, extra: Partial<WeekPacket> = {}): WeekPacket => ({ ...packet(w, { cities: sehirler() }), ...(e ? { ekonomi: e } : {}), ...extra });
const sat = (id: string, tur: string, sehir: number, calisan: number): HaritaFirmaSatiri => [id, tur, sehir, calisan, null, "npc", 0, "uretim"];
const sektorAdi = (x: string): string => `Sektör ${x}`;
const olcu = (id: string) => document.querySelector(`[data-isletme="${id}"]`) as HTMLElement;

type Ac = { sehir?: number | null; drawer?: (r: string, k: string, ref: string, w: number) => Promise<DrawerData> };
const goster = (weeks: WeekPacket[], ac: Ac = {}) => {
  const src = createFakeSource([], { kind: "live", caps: { city: true, chain: true }, drawer: vi.fn(ac.drawer ?? (async () => { throw new Error("yok"); })) });
  const cur = weeks.length ? weeks[weeks.length - 1]! : null;
  return render(
    <SimSourceProvider source={src}>
      <IsletmeIsgucuPaneli weeks={weeks} cur={cur} sehir={ac.sehir ?? null} sehirAdlari={ADLAR} sektorAdi={sektorAdi} isLive runId="r" />
    </SimSourceProvider>,
  );
};
const uc = () => [1, 2, 3].map((w) => paket(w, eko(w, w === 1 ? { hareket: null } : {})));

describe("M10 Isletmeler ve is gucu", () => {
  it("test_istihdam_oyuncu_npc_ayri_issiz_ve_isgucu_disi_ayri", () => {
    goster(uc());
    expect(olcu("oyuncu").textContent).toContain("30 kişi");
    expect(olcu("npc").textContent).toContain("470 kişi");
    expect(olcu("ozel").textContent).toContain("430 kişi");
    expect(olcu("kamu").textContent).toContain("100 kişi");
    expect(olcu("issiz_oyuncu").textContent).toContain("20 kişi");   // 2+3+4+5+6
    expect(olcu("issiz_npc").textContent).toContain("150 kişi");     // 10+20+30+40+50
    expect(olcu("isgucu_disi").textContent).toContain("110 kişi");   // 20..24
    expect(olcu("kapsam").textContent).toBe(t("tuketim.dunya_rozeti"));
  });

  it("test_sehir_secilince_sehir_degerleri", () => {
    goster(uc(), { sehir: 2 });
    expect(olcu("kapsam").textContent).toBe(t("tuketim.sehir_rozeti", { ad: "Cem" }));
    expect(olcu("ozel").textContent).toContain("102 kişi");
    expect(olcu("oyuncu").textContent).toContain("7 kişi");
    expect(olcu("issiz_oyuncu").textContent).toContain("4 kişi");
    expect(olcu("issiz_npc").textContent).toContain("30 kişi");
    expect(olcu("isgucu_disi").textContent).toContain("22 kişi");
    expect(olcu("hareket_kurulan").textContent).toContain("3");
    expect(olcu("hareket_batan").textContent).toContain("12");
    expect(olcu("sektor_kapsam").textContent).toBe(t("tuketim.dunya_rozeti"));
  });

  it("test_boy_dagilimi_dort_cubuk_ve_toplam_firma_sayisi", () => {
    goster(uc());
    const deg = [60, 15, 5, 1];
    const adlar = ["isletme.boy.k1", "isletme.boy.k2", "isletme.boy.k3", "isletme.boy.k4"] as const;
    adlar.forEach((k, i) => {
      const cubuk = screen.getByRole("progressbar", { name: t("isletme.boy.satir", { ad: t(k), n: deg[i]! }) });
      expect(cubuk).toBeInTheDocument();
      expect(olcu(`boy_${i + 1}`).textContent).toContain(String(deg[i]));
    });
    expect(olcu("boy_toplam").textContent).toBe(t("isletme.boy.toplam", { n: 81 }));
  });

  it("test_hareket_serisi_dort_cizgi_ilk_hafta_olculmuyor", () => {
    goster(uc());
    const fig = screen.getByRole("img", { name: t("isletme.hareket.grafik") }).closest("figure") as HTMLElement;
    for (const k of ["kurulan", "buyuyen", "kuculen", "batan"] as const) {
      expect(fig.querySelector(`[data-seri="hareket-${k}"]`)).toBeTruthy();
      expect(within(fig).getByText(new RegExp(t(`isletme.hareket.${k}`)))).toBeInTheDocument();
    }
    // ilk hafta null: yol iki noktadan (hafta 2 ve 3) oluşur
    const d = fig.querySelector('[data-seri="hareket-kurulan"]')!.getAttribute("d")!;
    expect(d.match(/[ML]/g)?.length).toBe(2);
    expect(d.startsWith("M")).toBe(true);
    expect(screen.getByText(t("isletme.hareket.ilk_hafta"))).toBeInTheDocument();
  });

  it("test_tuketim_ve_ozel_istihdam_ayni_grafikte", () => {
    const w = [paket(1, eko(1)), paket(2, eko(2, { harcama: null })), paket(3, eko(3))];
    goster(w);
    const fig = screen.getByRole("img", { name: t("isletme.tuketim_istihdam.aciklama") }).closest("figure") as HTMLElement;
    expect(fig.querySelector('[data-seri="harcama"]')).toBeTruthy();
    expect(fig.querySelector('[data-seri="ozel"]')).toBeTruthy();
    expect(within(fig).getByText(new RegExp(t("seri.harcama_toplam").replace(/[()]/g, "\\$&")))).toBeInTheDocument();
    expect(within(fig).getByText(new RegExp(t("seri.ozel_istihdam").replace(/[()]/g, "\\$&")))).toBeInTheDocument();
    // harcama 2. haftada null: çizgi iki parçaya kopar
    expect(fig.querySelector('[data-seri="harcama"]')!.getAttribute("d")!.match(/M/g)?.length).toBe(2);
    expect(fig.querySelector('[data-seri="ozel"]')!.getAttribute("d")!.match(/M/g)?.length).toBe(1);
  });

  it("test_endeks_son_degeri_yazili_ve_100_cizgisi_var", () => {
    goster(uc());
    expect(olcu("endeks_harcama").textContent).toMatch(/^Harcama: ilk ölçülen haftaya göre [+−]%\d+$/);
    expect(olcu("endeks_ozel").textContent).toMatch(/^Özel istihdam: ilk ölçülen haftaya göre [+−]%\d+$/);
    const fig = screen.getByRole("img", { name: t("isletme.tuketim_istihdam.aciklama") }).closest("figure") as HTMLElement;
    expect(fig.querySelector('[data-referans="100"]')).toBeTruthy();
  });

  it("test_sektor_calisan_sirali_ve_diger_satiri", () => {
    goster(uc());
    const tablo = screen.getByRole("table", { name: t("isletme.sektor.tablo") });
    const satirlar = within(tablo).getAllByRole("row").slice(1);
    expect(satirlar).toHaveLength(13);
    expect(within(satirlar[0]!).getByText("Sektör s0")).toBeInTheDocument();
    expect(within(satirlar[11]!).getByText("Sektör s11")).toBeInTheDocument();
    expect(within(satirlar[12]!).getByText(t("isletme.sektor.diger"))).toBeInTheDocument();
  });

  it("test_firma_secilince_calisan_serisi", async () => {
    const harita = { hafta: 1, firmalar: [sat("a", "un", 0, 30), sat("b", "kumas", 1, 12), sat("c", "un", 0, 0)] };
    const w = [paket(1, eko(1), { harita }), paket(2, eko(2), { harita: { hafta: 2, firmalar: [sat("a", "un", 0, 35), sat("b", "kumas", 1, 12)] } }), paket(3, eko(3), { haritaFark: { hafta: 3, taban: 2, degisen: [["a", "uretim", 40]], yeni: [], kapanan: [] } })];
    const drawer = vi.fn(async (_r: string, kind: string, ref: string, wk: number): Promise<DrawerData> => ({ kind, ref, week: wk, stale: false, title: "x", fields: { workers: 41 } }));
    goster(w, { drawer });
    expect(screen.queryByRole("img", { name: t("isletme.firma.grafik", { ad: "Sektör un" }) })).toBeNull();
    const dugme = screen.getByRole("button", { name: t("isletme.firma.satir", { sira: 1, tur: "Sektör un", calisan: 40 }) });
    expect(screen.queryByRole("button", { name: /\b0 çalışan/ })).toBeNull(); // 0 çalışanlı işletme seçenek değil
    fireEvent.click(dugme);
    const fig = (await screen.findByRole("img", { name: t("isletme.firma.grafik", { ad: "Sektör un" }) })).closest("figure") as HTMLElement;
    expect(fig.querySelector('[data-seri="firma"]')).toBeTruthy();
    await waitFor(() => expect(drawer).toHaveBeenCalledWith("r", "firm", "a", 3));
    await waitFor(() => expect(olcu("firma_kesin").textContent).toBe(t("isletme.firma.kesin", { n: 3, calisan: 41 })));
    expect(olcu("firma_yaklasik")).toBeTruthy(); // ara hafta (haritaFark) var
  });

  it("test_firma_harita_yoksa_kayit_yok", () => {
    goster(uc());
    expect(screen.getByText(t("isletme.firma.kayit_yok"))).toBeInTheDocument();
  });

  it("test_blok_yok_bos_durum", () => {
    goster([paket(1), paket(2)]);
    expect(screen.getByText(t("isletme.eski_sunucu"))).toBeInTheDocument();
    expect(screen.queryByText(t("isletme.istihdam.baslik"))).toBeNull();
  });

  it("test_olculmeyen_degerler_olculmuyor_ve_cokmez", () => {
    goster([paket(1, eko(1, { ozel: null, harcama: null, hareket: null }))], { sehir: 9 });
    expect(olcu("ozel").textContent).toContain(t("canli.gosterge.olculmuyor"));
    expect(olcu("isgucu_disi").textContent).toContain(t("canli.gosterge.olculmuyor"));
  });
});
