import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { DrawerData, SimEvent, WeekPacket, WorldEvent } from "@/oyun/sim/types";
import { haritaOf, packetOf } from "../helpers/fakeLiveServer";
import { ayrintilariAc, mountCanli, packets, state, week } from "../helpers/canliMount";
import { cityRows, packet } from "../helpers/sehirZincirVeri";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("pointerdown")); // bekleyen "Şartı değiştir" odak isteği biter
  vi.restoreAllMocks();
});

const HARITALI = { city: true, chain: true, harita: true };
const LONCALAR = (w: number) => packetOf("r", w, 1, { holdings: true }).holdings;
/** Şehir, zincir ve lonca verili, her haftada bina anlık görüntülü haftalar. */
const haritaliHaftalar = (n: number): SimEvent[] =>
  Array.from({ length: n }, (_, i) => week({ ...packet(i + 1), holdings: LONCALAR(i + 1), harita: haritaOf(i + 1) } as WeekPacket));
const ust = (id: string): HTMLElement => document.querySelector(`[data-ust="${id}"] dd`) as HTMLElement;
/** Harita tablosu (WebGL yokken yedek; her zaman erişilebilir liste). */
const tablo = async () => within(await screen.findByRole("region", { name: /\(liste\)$/ }));
const solPanel = () => screen.getByRole("complementary", { name: t("kurucu.sart.baslik") });
/** Sol (Şart) panel dışındaki açık panel: sağ bağlam paneli. */
const sagPanel = (): HTMLElement | null => screen.queryAllByRole("complementary").find((a) => a !== solPanel()) ?? null;
const baglam = (tur: string) => document.querySelector(`[data-baglam="${tur}"]`) as HTMLElement | null;
const alan = (kok: HTMLElement, id: string) => kok.querySelector(`[data-alan="${id}"] dd`)?.textContent;

describe("Kurucu şehir ekranı: kabuk", () => {
  it("test_tam_ekran_bolge_zaman_menu_secici_ve_sol_panel_sag_panel_yalniz_secimde", async () => {
    mountCanli([state(), ...packets(3)]);
    await screen.findByRole("region", { name: t("canli.saat") });
    const e = screen.getByRole("region", { name: t("ekran.ana") });
    expect(within(e).getByRole("button", { name: t("ayrintilar.dugme") })).toBeInTheDocument();
    expect(within(e).getByRole("button", { name: t("kurucu.menu.dugme") })).toBeInTheDocument();
    expect(within(e).getByRole("button", { name: "Şehir" })).toBeInTheDocument();
    expect(within(e).getByRole("group", { name: t("ekran.kontrol") })).toBeInTheDocument();
    expect(sagPanel()).toBeNull();
    expect(solPanel()).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Görünüm" })).toBeNull(); // eski sayfa görünümleri kalktı
  });

  it("test_kayitta_bina_verisi_yok_notu_ve_kamu_binalari_listede", async () => {
    mountCanli([state(), ...packets(3)], { kind: "replay" });
    expect((await screen.findAllByText(t("harita.bina_yok"))).length).toBeGreaterThan(0);
    const l = await tablo();
    expect(l.getByRole("button", { name: "Ada" })).toBeInTheDocument(); // şehir binası
    expect(l.getByRole("button", { name: t("harita.ahir") })).toBeInTheDocument();
  });

  it("test_canlida_bina_verisi_varken_not_yok", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI });
    await tablo();
    expect(screen.queryAllByText(t("harita.bina_yok"))).toHaveLength(0);
  });
});

describe("Kurucu şehir ekranı: üst metrikler", () => {
  it("test_dort_metrik_secili_sehrin_degerleri_gini_dunyanin", async () => {
    mountCanli([state(), ...packets(3, { world: { gini: 0.31 } })]);
    await waitFor(() => expect(ust("karsilama").textContent).toBe("%90")); // şehir 0: 0,9 - 0,003
    expect(ust("kasa").textContent).toBe("1 bin");
    expect(ust("issiz").textContent).toBe("%9"); // 10 / 110
    expect(ust("gini").textContent).toBe("0,31");
    const serit = document.querySelector(`[aria-label="${t("kurucu.ust.baslik")}"]`) as HTMLElement;
    for (const a of ["Talep karşılama", "Şehir kasası", "İşsizlik (oyuncu)", "Gini"]) expect(within(serit).getByText(a)).toBeInTheDocument();
  });

  it("test_sehir_degisince_metrikler_yeni_sehrin_olur", async () => {
    window.location.hash = "#/canli/r/2";
    mountCanli([state(), ...packets(3)]);
    await waitFor(() => expect(ust("karsilama").textContent).toBe("%70")); // 0,9 - 0,2 - 0,003
    expect(ust("kasa").textContent).toBe("3 bin");
    expect(ust("issiz").textContent).toBe("%11"); // 12 / 114
    expect(ust("gini").textContent).toBe("ölçülmüyor");
  });

  it("test_olculmeyen_deger_olculmuyor_sayi_uydurulmaz", async () => {
    const satirlar = cityRows(3).map((r) => (r.index === 0 ? { ...r, served: null, cash: null } : r));
    mountCanli([state(), ...packets(3, { cities: satirlar })]);
    await waitFor(() => expect(ust("karsilama").textContent).toBe("ölçülmüyor"));
    expect(ust("kasa").textContent).toBe("ölçülmüyor");
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
  });
});

describe("Kurucu şehir ekranı: zaman kontrolleri ve kısayollar", () => {
  it("test_zaman_kontrolleri_ekranin_icinde_ve_komut_gonderir", async () => {
    const { control } = mountCanli([state(), ...packets(3)]);
    const saat = await screen.findByRole("region", { name: t("canli.saat") });
    expect(screen.getByRole("region", { name: t("ekran.ana") }).contains(saat)).toBe(true);
    expect(within(saat).getByText("Hafta 3 / 200")).toBeInTheDocument();
    for (const ad of ["Oynat", "Bir hafta ilerle", "Sonraki kritik olaya atla"]) expect(within(saat).getByRole("button", { name: ad })).toBeInTheDocument();
    const hizlar = within(saat).getByRole("group", { name: "Oynatma hızı" });
    expect(within(hizlar).getAllByRole("button").map((b) => b.textContent)).toEqual(["1×", "4×", "16×"]);
    fireEvent.click(within(saat).getByRole("button", { name: "Oynat" }));
    await waitFor(() => expect(control).toHaveBeenCalledWith("r", { action: "play", speed: 1 }));
    fireEvent.click(within(hizlar).getByRole("button", { name: "16×" }));
    await waitFor(() => expect(control).toHaveBeenCalledWith("r", expect.objectContaining({ speed: 16 })));
  });

  it("test_kisayollar_bosluk_ok_rakam_calisir_giris_kutusunda_calismaz", async () => {
    const { control } = mountCanli([state(), ...packets(3)]);
    await screen.findByRole("region", { name: t("canli.saat") });
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(control).toHaveBeenCalledWith("r", { action: "play", speed: 1 }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(control).toHaveBeenCalledWith("r", { action: "step" }));
    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => expect(control).toHaveBeenCalledWith("r", expect.objectContaining({ speed: 16 })));
    const n = control.mock.calls.length;
    const kutu = document.createElement("input");
    document.body.append(kutu);
    kutu.focus();
    fireEvent.keyDown(kutu, { key: " " });
    expect(control.mock.calls.length).toBe(n);
    kutu.remove();
  });
});

describe("Kurucu şehir ekranı: sağ panel (işletme, meydan, şehir bilgisi, ahır)", () => {
  const firma = (ek: Record<string, unknown> = {}, kok: Partial<DrawerData> = {}): DrawerData => ({
    kind: "firm", ref: "f0", week: 3, stale: false, title: "Market",
    fields: { workers: 24, ownership: "npc", cash: 5000, price: 1.27, wage_avg: 15.5, sold_week: 42, product: "ekmek", profit_hist: [10, 12, -5, 20, 25], ...ek }, ...kok,
  });

  it("test_isletmeye_tiklayinca_sag_panel_acilir_alanlar_ve_kar_grafigi", async () => {
    const drawer = vi.fn(async () => firma());
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI, drawer });
    expect(sagPanel()).toBeNull();
    fireEvent.click((await (await tablo()).findAllByRole("button", { name: "Fırın" }))[0]!);
    const p = await waitFor(() => {
      const el = baglam("firm");
      if (!el) throw new Error("panel yok");
      return el;
    });
    await waitFor(() => expect(alan(p, "workers")).toBe("24"));
    expect(drawer).toHaveBeenCalledWith("r", "firm", expect.stringMatching(/^f\d+$/), 3);
    expect(sagPanel()).not.toBeNull();
    expect(alan(p, "wage_avg")).toBe("16 Akçe"); // ortak çekmece biçimi (tam sayı, Akçe)
    expect(alan(p, "price")).toBe("1,27 Akçe");
    expect(alan(p, "sold_week")).toBe("42 · ekmek");
    expect(alan(p, "sektor")).toBe("Fırın");
    expect(within(p).getByRole("region", { name: t("kurucu.baglam.kar") })).toBeInTheDocument();
    expect(p.querySelector("svg")).not.toBeNull();
    expect(within(p).getAllByText(t("kurucu.baglam.kar"), { exact: false }).filter((e) => /^H[1-6]$/.test(e.tagName) || e.tagName === "FIGCAPTION")).toHaveLength(1); // tek başlık
    expect(within(p).getByText(t("cekmece.hafta", { n: 3 }))).toBeInTheDocument();
  });

  it("test_kar_grafigi_tek_veri_noktasinda_bos_cizgi_yerine_yeterli_veri_yok_der", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI, drawer: async () => firma({ profit_hist: [10] }) });
    fireEvent.click((await (await tablo()).findAllByRole("button", { name: "Fırın" }))[0]!);
    const p = await waitFor(() => baglam("firm")!);
    await waitFor(() => expect(alan(p, "workers")).toBe("24"));
    expect(within(p).getByText(t("kurucu.baglam.kar_yetersiz"))).toBeInTheDocument();
    expect(within(p).queryByRole("region", { name: t("kurucu.baglam.kar") })).toBeNull();
    expect(p.querySelector("svg")).toBeNull();
  });

  it("test_eksik_alanlar_cizilmez_eski_veri_notu_gorunur", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI, drawer: async () => firma({ price: undefined, wage_avg: undefined, sold_week: undefined, profit_hist: [] }, { stale: true, week: 1 }) });
    fireEvent.click((await (await tablo()).findAllByRole("button", { name: "Fırın" }))[0]!);
    const p = await waitFor(() => baglam("firm")!);
    await waitFor(() => expect(alan(p, "workers")).toBe("24"));
    expect(alan(p, "price")).toBeUndefined();
    expect(alan(p, "wage_avg")).toBeUndefined();
    expect(p.querySelector("svg")).toBeNull();
    expect(within(p).getByText(t("cekmece.eski_hafta", { n: 1 }))).toBeInTheDocument();
  });

  it("test_cekmece_hatasi_alert_gosterir", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI, drawer: async () => { throw new Error("x"); } });
    fireEvent.click((await (await tablo()).findAllByRole("button", { name: "Fırın" }))[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("cekmece.yuklenemedi"));
  });

  it("test_meydan_yalniz_holdings_loncas_alanlari_haftalik_faiz_yok", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI });
    fireEvent.click((await (await tablo()).findAllByRole("button", { name: /^Lonca \d+$/ }))[0]!);
    const p = await waitFor(() => baglam("lonca")!);
    expect(within(sagPanel()!).getByRole("heading", { name: t("kurucu.baglam.meydan") })).toBeInTheDocument();
    const loncalar = LONCALAR(3)!.loncas;
    expect(p.querySelectorAll("details")).toHaveLength(loncalar.length);
    expect(p.querySelectorAll("details[open]")).toHaveLength(1); // seçili lonca açık
    const acik = p.querySelector("details[open]") as HTMLElement;
    const satir = loncalar.find((l) => l.ref === acik.getAttribute("data-lonca"))!;
    for (const k of ["members", "fee", "capital", "deposits", "credit_out", "equity", "owner"]) {
      const v = (satir as Record<string, unknown>)[k];
      if (v !== undefined && v !== null) expect(acik.querySelector(`[data-alan="${k}"]`), k).not.toBeNull();
    }
    expect(p.textContent).not.toMatch(/faiz/i); // pakette lonca faizi yok
    expect(within(p).getByText(t("kurucu.baglam.toplam_mevduat"))).toBeInTheDocument();
  });

  it("test_sehir_binasi_sehir_bilgisi_ve_sektor_talebi_ilk_8", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI });
    fireEvent.click(await (await tablo()).findByRole("button", { name: "Ada" }));
    const p = await waitFor(() => baglam("city")!);
    expect(within(sagPanel()!).getByRole("heading", { name: "Ada" })).toBeInTheDocument();
    expect(alan(p, "calisan")).toBe("100");
    expect(alan(p, "issiz")).toBe("10 (%9)");
    expect(alan(p, "isletme")).toBe("20");
    const satirlar = within(p).getAllByRole("row").slice(1);
    expect(satirlar.length).toBeGreaterThan(0);
    expect(satirlar.length).toBeLessThanOrEqual(8);
    expect(within(satirlar[0]!).getAllByRole("cell").map((c) => c.textContent)).toContain("%98"); // karşılanan: 1 - 0,02
  });

  it("test_ahir_bekleyen_sayisi", async () => {
    mountCanli([state(), ...packets(3, { world: { players_in_ahir: 4 } as never })]);
    fireEvent.click(await (await tablo()).findByRole("button", { name: t("harita.ahir") }));
    const p = await waitFor(() => baglam("ahir")!);
    expect(alan(p, "bekleyen")).toBe("4");
    expect(within(sagPanel()!).getByRole("heading", { name: t("harita.ahir") })).toBeInTheDocument();
  });

  it("test_panel_kapat_ve_esc_ve_sehir_degisince_secim_temizlenir", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI });
    fireEvent.click(await (await tablo()).findByRole("button", { name: "Ada" }));
    await waitFor(() => expect(sagPanel()).not.toBeNull());
    fireEvent.click(within(sagPanel()!).getByRole("button", { name: t("ekran.panel_kapat") }));
    expect(sagPanel()).toBeNull();
    fireEvent.click(await (await tablo()).findByRole("button", { name: "Ada" }));
    await waitFor(() => expect(sagPanel()).not.toBeNull());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(sagPanel()).toBeNull());
    // şehir değişince seçim temizlenir
    fireEvent.click(await (await tablo()).findByRole("button", { name: "Ada" }));
    await waitFor(() => expect(sagPanel()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Şehir" }));
    fireEvent.click(await screen.findByRole("option", { name: /Cem/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/canli/r/2"));
    expect(sagPanel()).toBeNull();
  });
});

describe("Kurucu şehir ekranı: şehir seçici ve katmanlar", () => {
  it("test_sehir_seciciler_ozet_gosterir_ve_rotayi_degistirir", async () => {
    mountCanli([state(), ...packets(3)]);
    fireEvent.click(await screen.findByRole("button", { name: "Şehir" }));
    const secenek = await screen.findByRole("option", { name: /Bora/ });
    expect(secenek.textContent).toMatch(/işletme/); // işletme · işsiz · talep özeti
    expect(secenek.textContent).toMatch(/işsiz/);
    expect(secenek.textContent).toMatch(/talep/);
    fireEvent.click(secenek);
    await waitFor(() => expect(window.location.hash).toBe("#/canli/r/1"));
    expect(await screen.findByRole("button", { name: "Şehir" })).toBeInTheDocument();
  });

  it("test_talep_katmani_lejant_ve_fiyat_katmani_dort_hafta_onceki_paketle", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI });
    await tablo();
    const grup = screen.getByRole("group", { name: t("harita.katman.grup") });
    expect(within(grup).getByRole("button", { name: t("harita.katman.yok") })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(grup).getByRole("button", { name: t("harita.katman.talep") }));
    expect(await screen.findByRole("list", { name: t("harita.katman.lejant") })).toBeInTheDocument();
    // fiyat: 3 haftalık koşuda 4 hafta önceki paket yok: katman veri vermez, lejant da yok
    fireEvent.click(within(grup).getByRole("button", { name: t("harita.katman.fiyat") }));
    await waitFor(() => expect(screen.queryByRole("list", { name: t("harita.katman.lejant") })).toBeNull());
  });

  it("test_fiyat_katmani_bes_haftada_dort_hafta_oncekiyle_kiyaslar", async () => {
    mountCanli([state({ week: 5 }), ...haritaliHaftalar(5)], { caps: HARITALI });
    await tablo();
    const grup = screen.getByRole("group", { name: t("harita.katman.grup") });
    fireEvent.click(within(grup).getByRole("button", { name: t("harita.katman.fiyat") }));
    const lejant = await screen.findByRole("list", { name: t("harita.katman.lejant") });
    // fiyatlar iki haftada da aynı (1,02): "yatay"
    expect(within(lejant).getByText(new RegExp(t("harita.lejant.fiyat.yatay")))).toBeInTheDocument();
    expect(lejant.textContent).toMatch(/Fiyat yatay: [1-9]/);
  });

  it("test_issizlik_katmani_lejant_cizmez_rozet_tabloda", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI });
    await tablo();
    fireEvent.click(within(screen.getByRole("group", { name: t("harita.katman.grup") })).getByRole("button", { name: t("harita.katman.issizlik") }));
    expect(await screen.findByText(t("harita.rozet.sehir", { n: 10 }))).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: t("harita.katman.lejant") })).toBeNull();
  });
});

describe("Kurucu şehir ekranı: koşu eylemleri tek kaynak", () => {
  const sayi = (ad: string) => screen.queryAllByRole("button", { name: ad }).length;

  it("test_pencere_kapaliyken_her_eylem_gorunur_yuzeyde_tek_kez", async () => {
    mountCanli([state(), ...packets(3)]);
    await screen.findByRole("region", { name: t("canli.saat") });
    expect(sayi(t("degistir.dugme"))).toBe(1);
    expect(sayi(t("ustcubuk.sart_dugme"))).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.menu.dugme") }));
    expect(sayi(t("ustcubuk.ara_durum"))).toBe(1);
    expect(sayi(t("ustcubuk.gunluk"))).toBe(1);
    expect(sayi(t("ustcubuk.kosular"))).toBe(1);
    expect(sayi(t("canli.sifirla.baslik"))).toBe(0); // yalnız Ayrıntılar > Koşu
  });

  it("test_ayrintilar_acikken_disaridaki_ornekler_cizilmez_pencerede_tek_kez", async () => {
    mountCanli([state(), ...packets(3)]);
    const pencere = await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    for (const ad of [t("degistir.dugme"), t("ustcubuk.sart_dugme"), t("ustcubuk.ara_durum"), t("canli.sifirla.baslik")]) {
      expect(sayi(ad), ad).toBe(1);
      expect(within(pencere).getAllByRole("button", { name: ad }), ad).toHaveLength(1);
    }
  });

  it("test_sart_panelinden_ve_menuden_acilan_katmanlar", async () => {
    mountCanli([state(), ...packets(3)]);
    fireEvent.click(await screen.findByRole("button", { name: t("ustcubuk.sart_dugme") }));
    expect(await screen.findByRole("dialog", { name: /Şart/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("diyalog.kapat") }));
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.menu.dugme") }));
    fireEvent.click(screen.getByRole("button", { name: t("ustcubuk.gunluk") }));
    expect(await screen.findByRole("dialog", { name: t("ustcubuk.gunluk") })).toBeInTheDocument();
  });

  it("test_menu_esc_ve_eylemde_kapanir_koşular_ve_ara_durum_rotasi", async () => {
    mountCanli([state(), ...packets(3)]);
    const dugme = await screen.findByRole("button", { name: t("kurucu.menu.dugme") });
    fireEvent.click(dugme);
    expect(dugme).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByRole("group", { name: t("ustcubuk.menu") }), { key: "Escape" });
    expect(dugme).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(dugme);
    fireEvent.click(screen.getByRole("button", { name: t("ustcubuk.ara_durum") }));
    expect(window.location.hash).toBe("#/sonuc/r");
  });
});

describe("Kurucu şehir ekranı: Ayrıntılar açıkken şehir etkileşimi kapalı", () => {
  it("test_tuval_inert_pencere_kapaninca_geri_acilir", async () => {
    mountCanli([state(), ...haritaliHaftalar(3)], { caps: HARITALI });
    await tablo();
    // tuval, kabuk bölgesinin ilk çocuğudur; pencere açıkken şehir tıklaması, sürükleme ve odak kapalıdır (aria-modal ile tutarlı)
    const tuval = () => screen.getByRole("region", { name: t("ekran.ana") }).firstElementChild as HTMLElement;
    expect(tuval()).not.toHaveAttribute("inert");
    const pencere = await ayrintilariAc();
    expect(tuval()).toHaveAttribute("inert");
    fireEvent.click(within(pencere).getByRole("button", { name: t("diyalog.kapat") }));
    await waitFor(() => expect(tuval()).not.toHaveAttribute("inert"));
  });
});

describe("Kurucu şehir ekranı: olay şeridi ve Tüm olaylar", () => {
  const olay = (id: string, w: number, ek: Partial<WorldEvent> = {}): SimEvent => ({
    type: "world_event",
    event: { id, week: w, kind: "good", textKey: "event.toparlanma", params: { hafta: w, oran: 72 }, critical: false, sector: null, rule_ids: [], ...ek },
  });

  it("test_son_olaylar_seritte_en_yeni_ilk_ve_tum_olaylar_pencereyi_acar", async () => {
    const { src } = mountCanli([state(), ...packets(3)]);
    await screen.findByRole("region", { name: t("canli.saat") });
    expect(screen.queryByRole("log")).toBeNull(); // olay yokken şerit yok
    act(() => {
      src.emit("r", olay("toparlanma:2", 2));
      src.emit("r", olay("toparlanma:3", 3));
    });
    const log = await screen.findByRole("log", { name: t("ekran.olay_baslik") });
    const satirlar = within(log).getAllByRole("listitem").map((l) => l.textContent ?? "");
    expect(satirlar[0]).toMatch(/^3\. hafta: /);
    expect(satirlar[1]).toMatch(/^2\. hafta: /);
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.olay_tumu") }));
    const pencere = await screen.findByRole("dialog", { name: t("ayrintilar.baslik") });
    expect(within(pencere).getByRole("tab", { name: t("ayrintilar.sekme.olaylar"), selected: true })).toBeInTheDocument();
  });
});

describe("Kurucu şehir ekranı: durum katmanları", () => {
  it("test_hata_ve_dikis_bantlari_kabukta_ayrintilar_acikken_koşu_sekmesinde", async () => {
    const { src } = mountCanli([state(), ...packets(3)]);
    await screen.findByRole("region", { name: t("canli.saat") });
    act(() => src.emit("r", { type: "error", messageKey: "hata.degisiklik_basarisiz" }));
    expect(await screen.findByText(t("hata.degisiklik_basarisiz"))).toBeInTheDocument();
    await ayrintilariAc(t("ayrintilar.sekme.kosu"));
    expect(screen.getAllByText(t("hata.degisiklik_basarisiz"))).toHaveLength(1); // aynı yüzeyde tek kopya
  });

});

describe("Kurucu şehir ekranı: rehber ipucu metinleri yeni yeri anlatır", () => {
  it("test_ipucu_metinleri_ayrintilar_penceresini_anar", () => {
    for (const k of ["rehber.ipucu.a", "rehber.ipucu.b", "rehber.ipucu.c"] as const) expect(t(k), k).toMatch(/^Ayrıntılar > (Genel|Olaylar): /);
  });
});

