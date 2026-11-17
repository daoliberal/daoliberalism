import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { HESAP_GECIKME_MS } from "@/oyun/screens/sart/DunyaHesabi";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import { sartTabani } from "@/oyun/screens/sart/sartMantik";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunConfig, SimSource, ValuesPatch, WorldPlan } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";
import { planYaniti } from "../helpers/dunyaPlan";
import { contractRegistry } from "../helpers/registryFixtures";

const registry = contractRegistry();
const baglam = { config: { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0 }, baseValues: {} as ValuesPatch };

function Host({ source }: { source: SimSource }) {
  const base = sartTabani(registry, {});
  const [patch, setPatch] = useState<ValuesPatch>({});
  return (
    <SimSourceProvider source={source}>
      <SartEditoru mode="builder" registry={registry} base={base} draft={{ ...base, ...patch }} context={{ durationWeeks: 200 }} onDraft={(n) => setPatch(n)} onizleme={baglam} />
    </SimSourceProvider>
  );
}
const dunyaGrubu = () => within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: /^\d+\. Dünya$/ });
const kaynak = (worldPlan?: SimSource["worldPlan"]): SimSource => createFakeSource([], { kind: "live", ...(worldPlan ? { worldPlan } : {}) });
const bekle = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Dünya grubu: canlı açılış hesabı (D8)", () => {
  it("A_kartlari_deneysel_rozetli_ve_kuruluşta_düzenlenebilir", () => {
    render(<Host source={kaynak(vi.fn(async () => planYaniti()))} />);
    fireEvent.click(dunyaGrubu());
    for (const ad of ["Nüfus başına işletme", "İşletme kapasitesi", "Kapasite büyüme tavanı", "Açılış talebi ve girdi stoku", "NPC başlangıç nakdi", "Açılış konut stoku", "Nüfus ölçeği", "İlk haftada işe alınan NPC oranı"]) {
      const k = screen.getByRole("article", { name: ad });
      expect(within(k).getByText(t("rozet.experimental"))).toBeInTheDocument();
    }
  });

  it("kayit_kipinde_canli_modelde_hesaplanir_bilgisi_ve_istek_yok", () => {
    render(<Host source={createFakeSource([], { kind: "replay" })} />);
    fireEvent.click(dunyaGrubu());
    expect(screen.getByText(t("sart.hesap.canli_yok"))).toBeInTheDocument();
  });

  it("worldPlan_olmayan_canli_kaynakta_da_ayni_bilgi", () => {
    render(<Host source={kaynak()} />);
    fireEvent.click(dunyaGrubu());
    expect(screen.getByText(t("sart.hesap.canli_yok"))).toBeInTheDocument();
  });

  it("gecikmeden_sonra_tek_istek_ve_kisi_isletme_diliyle_hesap", async () => {
    const worldPlan = vi.fn<(c: RunConfig) => Promise<WorldPlan>>(async () => planYaniti());
    render(<Host source={kaynak(worldPlan)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS - 50);
    expect(worldPlan).not.toHaveBeenCalled();
    await bekle(100);
    expect(worldPlan).toHaveBeenCalledTimes(1);          // seçilen = varsayılan: tek istek
    expect(worldPlan.mock.calls[0]![0].values).toEqual({});
    expect(screen.getByText(/toplam 6\.600 kişi, bunların 1\.500 oyuncu ve 5\.100 NPC/)).toBeInTheDocument();
    expect(screen.getByText(/İlk haftada 2\.663 NPC işe alınır/)).toBeInTheDocument();
    expect(screen.getByText(/124 yerleşik işletme, bin kişi başına 18,8/)).toBeInTheDocument();
    expect(screen.getByText(/Kapasiteye takılan 2 tür: Buğday tarlası, Silika madeni/)).toBeInTheDocument();
    expect(screen.getByText(/Kapasite büyüme tavanı: sabit taban/)).toBeInTheDocument();
    expect(screen.getByText(/Konut stoku: 2\.000 konut, açılışta 1\.650 kiracı/)).toBeInTheDocument();
    const tablo = screen.getByRole("table", { name: t("sart.hesap.tur_tablo") });
    expect(within(tablo).getByRole("row", { name: /Buğday tarlası/ }).textContent).toContain("75 kişi sığmıyor");
  });

  it("tuslama_firtinasi_tek_istege_iner_son_deger_gider", async () => {
    const worldPlan = vi.fn<(c: RunConfig) => Promise<WorldPlan>>(async () => planYaniti());
    render(<Host source={kaynak(worldPlan)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    worldPlan.mockClear();
    const oyuncu = within(screen.getByRole("article", { name: "Şehir başına oyuncu" })).getByRole("textbox");
    for (const v of ["8", "80", "800"]) {
      fireEvent.change(oyuncu, { target: { value: v } });
      fireEvent.blur(oyuncu);
      await bekle(100);
    }
    expect(worldPlan).not.toHaveBeenCalled();
    await bekle(HESAP_GECIKME_MS);
    expect(worldPlan).toHaveBeenCalledTimes(1);          // varsayılan önbellekte; yalnız seçilen istenir
    expect(worldPlan.mock.calls[0]![0].values).toMatchObject({ sehir_basina_oyuncu: 800 });
  });

  it("eski_yanit_yeni_yanitin_ustune_yazilmaz", async () => {
    const yavas = planYaniti({ firms: { total: 111, perCity: [], per1000: 1 } });
    const hizli = planYaniti({ firms: { total: 222, perCity: [], per1000: 2 } });
    let ilkCoz: (p: WorldPlan) => void = () => {};
    const worldPlan = vi.fn((c: RunConfig) => {
      if (c.values.sehir_basina_oyuncu === 800) return Promise.resolve(hizli);
      if (c.values.sehir_basina_oyuncu === 700) return new Promise<WorldPlan>((r) => { ilkCoz = r; });
      return Promise.resolve(planYaniti());
    });
    render(<Host source={kaynak(worldPlan)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    const oyuncu = within(screen.getByRole("article", { name: "Şehir başına oyuncu" })).getByRole("textbox");
    fireEvent.change(oyuncu, { target: { value: "700" } });
    fireEvent.blur(oyuncu);
    await bekle(HESAP_GECIKME_MS + 10);                   // 700 için istek uçuşta (çözülmedi)
    fireEvent.change(oyuncu, { target: { value: "800" } });
    fireEvent.blur(oyuncu);
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.getByText(/222 yerleşik işletme/)).toBeInTheDocument();
    await act(async () => { ilkCoz(yavas); await Promise.resolve(); });
    expect(screen.getByText(/222 yerleşik işletme/)).toBeInTheDocument();
    expect(screen.queryByText(/111 yerleşik işletme/)).toBeNull();
  });

  it("varsayilanla_karsilastirma_yalniz_degisince_gorunur", async () => {
    const worldPlan = vi.fn(async (c: RunConfig) => (c.values.sehir_basina_oyuncu === 800 ? planYaniti({ firms: { total: 300, perCity: [], per1000: 10 } }) : planYaniti()));
    render(<Host source={kaynak(worldPlan)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.queryByText(/\(varsayılan dünyada \d/)).toBeNull();
    const oyuncu = within(screen.getByRole("article", { name: "Şehir başına oyuncu" })).getByRole("textbox");
    fireEvent.change(oyuncu, { target: { value: "800" } });
    fireEvent.blur(oyuncu);
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.getByText(/300 yerleşik işletme.*varsayılan dünyada 124/)).toBeInTheDocument();
  });

  it("sunucu_hatasi_ve_gecersiz_ayar_ayri_metinle", async () => {
    const hata = vi.fn(async () => { throw new SimUnsupported("hata.sunucu_yok"); });
    render(<Host source={kaynak(hata)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.getByText(t("sart.hesap.hata"))).toBeInTheDocument();
    cleanup();
    const gecersiz = vi.fn(async () => { throw new SimUnsupported("invalid"); });
    render(<Host source={kaynak(gecersiz)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.getByText(t("sart.hesap.gecersiz"))).toBeInTheDocument();
  });

  it("tikanan_tur_yoksa_bunu_soyler", async () => {
    render(<Host source={kaynak(async () => planYaniti({ blockedKinds: [], kinds: planYaniti().kinds.map((k) => ({ ...k, blocked: false, shortfall: 0 })) }))} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.getByText(t("sart.hesap.tikanan_yok"))).toBeInTheDocument();
  });

  it("kar_hanelere_temettuyse_kapasite_tavani_yok_denir", async () => {
    render(<Host source={kaynak(async () => planYaniti({ capGrowth: "yok" }))} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.getByText(t("sart.hesap.tavan.yok"))).toBeInTheDocument();
    expect(screen.queryByText(t("sart.hesap.tavan.sabit", { en_az: "75", en_cok: "240" }))).toBeNull();
  });

  it("acilis_kapasitesine_bagli_tavan_kurali_ve_konut_kapaliysa_bilgi", async () => {
    render(<Host source={kaynak(async () => planYaniti({ capGrowth: "acilis_kapasitesi", housing: null }))} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    expect(screen.getByText(t("sart.hesap.tavan.acilis"))).toBeInTheDocument();
    expect(screen.getByText(t("sart.hesap.konut_yok"))).toBeInTheDocument();
  });
});

describe("Dünya grubu: işgücü satırı, bekleme işareti ve canlı bölge (D9, D8 taşınanları)", () => {
  const hane: WorldPlan["laborForce"] = { mode: "hane", players: 1500, npc: 2550, dependents: 2550, participation: 0.5, total: 4050 };

  it("tek_kisi_kipinde_isgucu_nufustan_ayri_yazilir_ve_her_npcnin_isgucunde_oldugu_soylenir", async () => {
    render(<Host source={kaynak(async () => planYaniti())} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    const satir = document.querySelector('[data-hesap="isgucu"]') as HTMLElement;
    expect(satir.textContent).toBe("İşgücü: 6.600 kişi (1.500 oyuncu ve 5.100 NPC). Tek kişi kipinde her NPC işgücündedir.");
  });

  it("hane_kipinde_isgucu_nufustan_kucuk_ve_bakmakla_yukumlu_sayisi_yazilir", async () => {
    const worldPlan = vi.fn(async (c: RunConfig) => (c.values.npc_hanesi ? planYaniti({ laborForce: hane }) : planYaniti()));
    render(<Host source={kaynak(worldPlan)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    const kart = screen.getByRole("article", { name: "NPC hanesi ve işgücüne katılım" });
    fireEvent.click(within(kart).getByRole("button", { name: "hane" }));
    await bekle(HESAP_GECIKME_MS + 10);
    const satir = document.querySelector('[data-hesap="isgucu"]') as HTMLElement;
    expect(satir.textContent).toContain("İşgücü: 4.050 kişi (1.500 oyuncu ve işgücündeki 2.550 NPC)");
    expect(satir.textContent).toContain("2.550 NPC işgücü dışında ve bakmakla yükümlü (katılım oranı %50)");
    expect(satir.textContent).toContain("(varsayılan dünyada 6.600)");
  });

  it("eski_sunucuda_isgucu_alani_yoksa_toplam_nufus_satiri_geri_dusulur", async () => {
    const eski = planYaniti();
    delete (eski as { laborForce?: unknown }).laborForce;
    render(<Host source={kaynak(async () => eski)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    expect((document.querySelector('[data-hesap="isgucu"]') as HTMLElement).textContent).toBe(t("sart.hesap.isgucu", { n: "6.600" }));
  });

  it("istek_beklerken_eski_sonuc_gorunur_kalir_ve_bolum_aria_busy_isaretlenir", async () => {
    let coz: (p: WorldPlan) => void = () => {};
    const worldPlan = vi.fn((c: RunConfig) => (c.values.sehir_basina_oyuncu === 800 ? new Promise<WorldPlan>((r) => { coz = r; }) : Promise.resolve(planYaniti())));
    render(<Host source={kaynak(worldPlan)} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    const bolum = document.querySelector("[data-dunya-hesabi]") as HTMLElement;
    expect(bolum.getAttribute("aria-busy")).toBe("false");
    const oyuncu = within(screen.getByRole("article", { name: "Şehir başına oyuncu" })).getByRole("textbox");
    fireEvent.change(oyuncu, { target: { value: "800" } });
    fireEvent.blur(oyuncu);
    await bekle(10);
    expect(bolum.getAttribute("aria-busy")).toBe("true");                         // debounce bekleniyor: eski sonuç hâlâ ekranda
    expect(screen.getByText(/124 yerleşik işletme/)).toBeInTheDocument();
    await bekle(HESAP_GECIKME_MS + 10);
    expect(bolum.getAttribute("aria-busy")).toBe("true");                         // istek uçuşta
    await act(async () => { coz(planYaniti({ firms: { total: 300, perCity: [], per1000: 10 } })); await Promise.resolve(); });
    expect(bolum.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByText(/300 yerleşik işletme/)).toBeInTheDocument();
  });

  it("canli_bolge_yalniz_ozet_satiridir_tum_blok_duyurulmaz", async () => {
    render(<Host source={kaynak(async () => planYaniti())} />);
    fireEvent.click(dunyaGrubu());
    await bekle(HESAP_GECIKME_MS + 10);
    const bolum = document.querySelector("[data-dunya-hesabi]") as HTMLElement;
    const canli = bolum.querySelectorAll('[aria-live], [role="status"]');
    expect(canli).toHaveLength(1);
    expect((canli[0] as HTMLElement).getAttribute("data-hesap")).toBe("ozet");
    expect(canli[0]!.textContent).toBe("Açılış hesabı güncellendi: işgücü 6.600 kişi, ilk haftada 2.663 NPC işe alınır, 2 tür kapasiteye takılıyor.");
  });
});

describe("Kartlar: NPC hanesi ve açılış geçişi (D9)", () => {
  it("dunya_grubunda_deneysel_rozetli_iki_yeni_kart", () => {
    render(<Host source={kaynak(vi.fn(async () => planYaniti()))} />);
    fireEvent.click(dunyaGrubu());
    for (const ad of ["NPC hanesi ve işgücüne katılım", "Açılış geçişi"]) {
      const k = screen.getByRole("article", { name: ad });
      expect(within(k).getByText(t("rozet.experimental"))).toBeInTheDocument();
    }
  });
});
