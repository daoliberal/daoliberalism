import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { OYUNCU_ANAHTARI, oturumlukKimligiSifirla, oyuncuKimligi } from "@/oyun/lib/oyuncuKimligi";
import { DaoEkrani } from "@/oyun/screens/dao/DaoEkrani";
import { DaoSonuc } from "@/oyun/screens/dao/DaoSonuc";
import { daoAdlari } from "@/oyun/screens/dao/DaoYardim";
import { Sonuc } from "@/oyun/screens/sonuc/Sonuc";
import { Yayinla } from "@/oyun/screens/sonuc/Yayinla";
import { createLiveSource } from "@/oyun/sim/live";
import { parseDunyaDetay, parseDunyaOzetler, parseDunyaSkor, parseDunyaYayin, parseInfo, parseState } from "@/oyun/sim/live/wire";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunState, SimSource } from "@/oyun/sim/types";
import { GOZLEM_KURUCU } from "../helpers/daoVeri";
import { createFakeLiveServer, type FakeLiveServer } from "../helpers/fakeLiveServer";
import { createFakeSource } from "../helpers/fakeSource";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

const ADLAR = ["Ada", "Bora", "Cem", "Dil", "Efe"];
const kosu = (over: Partial<RunState> = {}): RunState => ({
  runId: "r", status: "ended", week: 100, durationWeeks: 100, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "dayanikli_taban", name: "Kıtlık", cityNames: ADLAR, ...over,
});
const TARIF = { v: 1, templateId: "dayanikli_taban", durationWeeks: 100, seedIndex: 0, values: {} };

let sources: SimSource[] = [];
function canli(): { server: FakeLiveServer; source: SimSource } {
  const server = createFakeLiveServer();
  const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  sources.push(source);
  return { server, source };
}
beforeEach(() => {
  window.localStorage.clear();
  oturumlukKimligiSifirla();
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  sources.forEach((s) => s.dispose());
  sources = [];
  vi.restoreAllMocks();
});

describe("oyuncu kimliği", () => {
  it("kalici_ve_gecerli", () => {
    const a = oyuncuKimligi();
    expect(a).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(window.localStorage.getItem(OYUNCU_ANAHTARI)).toBe(a);
    expect(oyuncuKimligi()).toBe(a);
  });
  it("depolama_hata_verirse_oturumluk_kimlik_degismez", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("yasak"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("yasak"); });
    const a = oyuncuKimligi();
    expect(a).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(oyuncuKimligi()).toBe(a);
  });
  it("bozuk_kayit_yenilenir", () => {
    window.localStorage.setItem(OYUNCU_ANAHTARI, "x");
    const a = oyuncuKimligi();
    expect(a).not.toBe("x");
    expect(window.localStorage.getItem(OYUNCU_ANAHTARI)).toBe(a);
  });
});

describe("Yayınla (Sonuç ekranı)", () => {
  it("sonuc_ekraninda_gorunur_ve_sahte_kaynakta_kapali_degilse_cikar", async () => {
    const src = createFakeSource([{ type: "state", state: kosu() }], { kind: "live" });
    Object.assign(src, { dunyaYayinla: vi.fn() });
    render(
      <SimSourceProvider source={src}>
        <Sonuc runId="r" restore={{ status: "ready" }} />
      </SimSourceProvider>,
    );
    expect(await screen.findByRole("heading", { name: t("yayinla.dugme") })).toBeInTheDocument();
  });

  it("kayit_kaynaginda_ve_dao_kosusunda_gorunmez", () => {
    const rep = createFakeSource([], { kind: "replay" });
    Object.assign(rep, { dunyaYayinla: vi.fn() });
    const { container } = render(<SimSourceProvider source={rep}><Yayinla state={kosu()} /></SimSourceProvider>);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const live = createFakeSource([], { kind: "live" });
    Object.assign(live, { dunyaYayinla: vi.fn() });
    const r2 = render(<SimSourceProvider source={live}><Yayinla state={kosu({ mode: "dao" })} /></SimSourceProvider>);
    expect(r2.container).toBeEmptyDOMElement();
  });

  it("dogrular_yayinlar_baglantiyi_gosterir_ve_kalici_degil_uyarisi_cikar", async () => {
    const { server, source } = canli();
    render(<SimSourceProvider source={source}><Yayinla state={kosu()} /></SimSourceProvider>);
    expect(await screen.findByText(t("yayinla.kalici_degil"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("yayinla.dugme") }));
    const ad = screen.getByLabelText(t("yayinla.ad"));
    expect(ad).toHaveValue("Kıtlık");
    fireEvent.change(ad, { target: { value: "" } });
    expect(screen.getByRole("button", { name: t("yayinla.gonder") })).toBeDisabled();
    fireEvent.change(ad, { target: { value: "Zor dünya" } });
    fireEvent.change(screen.getByLabelText(t("yayinla.aciklama")), { target: { value: "Kıtlık var" } });
    fireEvent.click(screen.getByRole("button", { name: t("yayinla.gonder") }));
    const baglanti = await screen.findByLabelText(t("yayinla.baglanti"));
    const kod = [...server.dunyalar.keys()][0]!;
    expect(baglanti).toHaveValue(`http://127.0.0.1:8765/d/${kod}`);
    const istek = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/api/dunyalar"))!;
    expect(istek.body).toMatchObject({ ad: "Zor dünya", aciklama: "Kıtlık var", oyuncu: oyuncuKimligi(), tarif: { v: 1, templateId: "dayanikli_taban", durationWeeks: 100 } });
    expect(JSON.stringify(istek.body)).not.toContain("Ada"); // şehir adları tarife girmez
    const yaz = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: yaz }, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: t("yayinla.kopyala") }));
    await waitFor(() => expect(yaz).toHaveBeenCalledWith(`http://127.0.0.1:8765/d/${kod}`));
    expect(await screen.findByRole("button", { name: t("yayinla.kopyalandi") })).toBeInTheDocument();
  });

  it("ad_uzunlugu_kod_noktasiyla_sayilir_sunucuyla_ayni", async () => {
    const { source } = canli();
    render(<SimSourceProvider source={source}><Yayinla state={kosu()} /></SimSourceProvider>);
    fireEvent.click(await screen.findByRole("button", { name: t("yayinla.dugme") }));
    const ad = screen.getByLabelText(t("yayinla.ad"));
    fireEvent.change(ad, { target: { value: "😀".repeat(60) } }); // 60 kod noktası = 120 UTF-16 birimi: sınır içinde, kesilmez
    expect([...(ad as HTMLInputElement).value]).toHaveLength(60);
    fireEvent.change(ad, { target: { value: "😀".repeat(61) } });
    expect([...(ad as HTMLInputElement).value]).toHaveLength(60);
  });

  it("bitmemis_kosuda_gorunmez", () => {
    const { source } = canli();
    for (const status of ["running", "paused", "failed"] as const) {
      const r = render(<SimSourceProvider source={source}><Yayinla state={kosu({ status })} /></SimSourceProvider>);
      expect(r.container).toBeEmptyDOMElement();
      r.unmount();
    }
  });

  it("kalici_sunucuda_uyari_yok", async () => {
    const { server, source } = canli();
    server.dunyalarKalici = true;
    render(<SimSourceProvider source={source}><Yayinla state={kosu()} /></SimSourceProvider>);
    await screen.findByRole("button", { name: t("yayinla.dugme") });
    await waitFor(() => expect(server.requests.some((r) => r.path.endsWith("/info"))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(t("yayinla.kalici_degil"))).toBeNull();
  });

  it("sunucu_reddi_metin_gosterir", async () => {
    const { server, source } = canli();
    const oyuncu = oyuncuKimligi();
    for (let i = 0; i < 20; i++) server.dunyalar.set(`K${i}`, { kod: `K${i}`, ad: "x", aciklama: "", tarif: TARIF, modelSurumu: server.guncelSurum, kurucu: oyuncu, olusturma: i, oynanma: 0 });
    render(<SimSourceProvider source={source}><Yayinla state={kosu()} /></SimSourceProvider>);
    fireEvent.click(await screen.findByRole("button", { name: t("yayinla.dugme") }));
    fireEvent.click(screen.getByRole("button", { name: t("yayinla.gonder") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("yayinla.hata_sinir"));
    fireEvent.change(screen.getByLabelText(t("yayinla.ad")), { target: { value: "bad‮ad" } });
    fireEvent.click(screen.getByRole("button", { name: t("yayinla.gonder") }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(t("yayinla.hata_gecersiz")));
  });
});

function dunyaKur(server: FakeLiveServer, over: Partial<{ kod: string; modelSurumu: string; kurucu: string; oynanma: number }> = {}) {
  const kod = over.kod ?? "K7M2QXA";
  server.dunyalar.set(kod, { kod, ad: "Kıtlık", aciklama: "Zor dünya", tarif: TARIF, modelSurumu: server.guncelSurum, kurucu: "kurucu-12345", olusturma: 1, oynanma: 3, ...over });
  return kod;
}
const skorEkle = (server: FakeLiveServer, kod: string, id: string, ad: string | null, dilim: number, servet: number) =>
  server.sonuclar.set(id, { kod, runId: id, oyuncu: "o", ad, dilim, unvan: "usta", isletme: 2, servet });

describe("DaoDunya", () => {
  it("ad_aciklama_oynanma_ve_skor_tablosu_cizilir", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    skorEkle(server, kod, "a", "Ayşe", 3, 100);
    skorEkle(server, kod, "b", null, 5, 50);
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao", dunya: kod }} /></SimSourceProvider>);
    expect(await screen.findByRole("heading", { name: "Kıtlık" })).toBeInTheDocument();
    expect(screen.getByText("Zor dünya")).toBeInTheDocument();
    expect(screen.getByText(t("dunya.oynanma", { n: 3 }))).toBeInTheDocument();
    const tablo = screen.getByRole("table", { name: t("dunya.skor") });
    const satirlar = within(tablo).getAllByRole("row");
    expect(satirlar).toHaveLength(3);
    expect(satirlar[1]).toHaveTextContent(`1. ${t("dunya.skor.adsiz")}`); // dilim 5 önde
    expect(satirlar[2]).toHaveTextContent("2. Ayşe");
  });

  it("bos_skor_metni", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao", dunya: kod.toLowerCase() }} /></SimSourceProvider>);
    expect(await screen.findByText(t("dunya.skor_yok"))).toBeInTheDocument();
  });

  it("bu_dunyada_oyna_oyna_cagirir_ve_yonlendirir", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao", dunya: kod }} /></SimSourceProvider>);
    fireEvent.click(await screen.findByRole("button", { name: t("dunya.oyna") }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/dao\/run\d+$/));
    const istek = server.requests.find((r) => r.path.endsWith(`/dunyalar/${kod}/oyna`))!;
    expect(istek.body).toEqual({ oyuncu: oyuncuKimligi() });
    const id = window.location.hash.slice("#/dao/".length);
    expect(server.run(id)?.state).toMatchObject({ mode: "dao", durationWeeks: 520, dunyaKodu: kod });
    expect(server.dunyalar.get(kod)!.oynanma).toBe(4);
  });

  it("eski_surum_metni_ve_oyna_kapali", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server, { modelSurumu: "v12-eski" });
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao", dunya: kod }} /></SimSourceProvider>);
    expect(await screen.findByText(t("dunya.eski_surum"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("dunya.oyna") })).toBeDisabled();
  });

  it("eski_surum_oyna_reddi_metin_gosterir", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao", dunya: kod }} /></SimSourceProvider>);
    const dugme = await screen.findByRole("button", { name: t("dunya.oyna") });
    server.guncelSurum = "v14"; // sayfa açıldıktan sonra sunucu güncellendi
    fireEvent.click(dugme);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("dunya.eski_surum"));
    expect(window.location.hash).toBe("");
  });

  it("bulunamayan_dunya_metni", async () => {
    const { source } = canli();
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao", dunya: "YOKYOK2" }} /></SimSourceProvider>);
    expect(await screen.findByText(t("dunya.yok"))).toBeInTheDocument();
  });

  it("kayit_kaynaginda_sunucu_yok_uyarisi", () => {
    const src = createFakeSource([], { kind: "replay" });
    render(<SimSourceProvider source={src}><DaoEkrani route={{ name: "dao", dunya: "K7M2QXA" }} /></SimSourceProvider>);
    expect(screen.getByText(t("dao.sunucu_yok"))).toBeInTheDocument();
  });
});

describe("Benim dünyalarım", () => {
  it("sekmede_kendi_dunyalarini_listeler_ve_acar", async () => {
    const { server, source } = canli();
    const ben = oyuncuKimligi();
    dunyaKur(server, { kod: "AAAAAAA", kurucu: ben, oynanma: 2 });
    dunyaKur(server, { kod: "BBBBBBB", kurucu: "baska-oyuncu-1" });
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao" }} /></SimSourceProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: t("dunyalarim.baslik") }));
    expect(await screen.findByText(t("dunya.oynanma", { n: 2 }))).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(server.requests.some((r) => r.path.includes(`/dunyalar?kurucu=${ben}`))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: t("dunyalarim.ac") }));
    expect(window.location.hash).toBe("#/dao/d/AAAAAAA");
  });

  it("bos_liste_metni", async () => {
    const { source } = canli();
    render(<SimSourceProvider source={source}><DaoEkrani route={{ name: "dao" }} /></SimSourceProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: t("dunyalarim.baslik") }));
    expect(await screen.findByText(t("dunyalarim.yok"))).toBeInTheDocument();
  });
});

describe("DAO sonu: görünen ad", () => {
  const ad = daoAdlari(ADLAR, null);
  async function bitir(server: FakeLiveServer, source: SimSource, kod: string) {
    server.dunyalar.get(kod);
    const h = await source.dunyaOyna!(kod, oyuncuKimligi());
    const run = server.run(h.runId)!;
    // Olay çıkana kadar: model "kurabilir_oldu" gibi olaylarda durur, bu yüzden bitene kadar yeniden basılır.
    for (let i = 0; i < 20 && run.state.status !== "ended"; i++) await source.control(h.runId, { action: "olay" });
    expect(run.state.status).toBe("ended");
    return { runId: h.runId, state: run.state };
  }
  const goster = (source: SimSource, runId: string, state: RunState) =>
    render(<SimSourceProvider source={source}><DaoSonuc g={GOZLEM_KURUCU} state={{ ...state, runId }} ad={ad} onKapat={() => {}} /></SimSourceProvider>);

  it("dunyaya_bagli_degilse_ad_sorulmaz", () => {
    const src = createFakeSource([], { kind: "live" });
    Object.assign(src, { daoAd: vi.fn() });
    goster(src, "r", kosu({ mode: "dao" }));
    expect(screen.queryByLabelText(t("dao.ad_sor"))).toBeNull();
  });

  it("ad_yazilir_sonuc_yok_kisa_tekrar_denenir", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    const { runId, state } = await bitir(server, source, kod);
    server.sonucYokSayisi = 2;
    goster(source, runId, state);
    fireEvent.change(screen.getByLabelText(t("dao.ad_sor")), { target: { value: "Ayşe" } });
    fireEvent.click(screen.getByRole("button", { name: t("dao.ad_gonder") }));
    expect(await screen.findByText(t("dao.ad_kaydedildi"), undefined, { timeout: 3000 })).toBeInTheDocument();
    const istekler = server.requests.filter((r) => r.path.endsWith(`/runs/${runId}/dao/ad`));
    expect(istekler).toHaveLength(3);
    expect(istekler[2]!.body).toEqual({ ad: "Ayşe", oyuncu: oyuncuKimligi() });
    const skor = await source.dunyaSkor!(kod);
    expect(skor[0]!.ad).toBe("Ayşe");
  });

  it("ad_var_ve_oyuncu_uyusmuyor_metinleri", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    const { runId, state } = await bitir(server, source, kod);
    goster(source, runId, state);
    const alan = screen.getByLabelText(t("dao.ad_sor"));
    fireEvent.change(alan, { target: { value: "Ayşe" } });
    server.sonuclar.get(runId)!.ad = "Önceki";
    fireEvent.click(screen.getByRole("button", { name: t("dao.ad_gonder") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("dao.ad_var"));
    server.sonuclar.get(runId)!.ad = null;
    server.sonuclar.get(runId)!.oyuncu = "baskasi-12345";
    fireEvent.click(screen.getByRole("button", { name: t("dao.ad_gonder") }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(t("dao.ad_baskasi")));
  });

  it("sonuc_yok_tukenirse_ayri_metin", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    const { runId, state } = await bitir(server, source, kod);
    server.sonucYokSayisi = 99;
    goster(source, runId, state);
    fireEvent.change(screen.getByLabelText(t("dao.ad_sor")), { target: { value: "Ayşe" } });
    fireEvent.click(screen.getByRole("button", { name: t("dao.ad_gonder") }));
    expect(await screen.findByRole("alert", undefined, { timeout: 6000 })).toHaveTextContent(t("dao.ad_sonuc_yok"));
    expect(server.requests.filter((r) => r.path.endsWith("/dao/ad"))).toHaveLength(5);
  }, 10000);

  it("sokulunce_yeniden_deneme_durur", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    const { runId, state } = await bitir(server, source, kod);
    server.sonucYokSayisi = 99;
    const r = goster(source, runId, state);
    fireEvent.change(screen.getByLabelText(t("dao.ad_sor")), { target: { value: "Ayşe" } });
    fireEvent.click(screen.getByRole("button", { name: t("dao.ad_gonder") }));
    await waitFor(() => expect(server.requests.filter((x) => x.path.endsWith("/dao/ad"))).toHaveLength(1));
    r.unmount();
    await new Promise((res) => setTimeout(res, 1500));
    expect(server.requests.filter((x) => x.path.endsWith("/dao/ad"))).toHaveLength(1);
  });
});

describe("sözleşme örnekleri", () => {
  const FIX = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/server/tests/fixtures/wire_contract.json"), "utf-8")) as Record<string, unknown>;
  it("gercek_sunucu_ornekleri_ayristirilir", () => {
    expect(parseDunyaYayin(FIX.dunya_yayinla)).toEqual({ kod: "K7M2QXA", baglanti: "/d/K7M2QXA" });
    expect(parseDunyaDetay(FIX.dunya_getir)).toMatchObject({ kod: "K7M2QXA", ad: "Kıtlık", oynanma: 1, modelSurumu: "v13.3-1a2b3c4d", guncelSurum: "v13.3-1a2b3c4d" });
    expect(parseDunyaOzetler(FIX.dunya_liste)[0]).toMatchObject({ kod: "K7M2QXA", baglanti: "/d/K7M2QXA" });
    expect(parseDunyaSkor(FIX.dunya_skor)).toEqual([{ ad: "Ayşe", dilim: 3, unvan: "cirak", isletme: 0, servet: 102 }]);
    expect(parseState(FIX.state_dao_dunya).dunyaKodu).toBe("K7M2QXA");
    expect(parseInfo({ ...(FIX.info as object), ...(FIX.info_dunyalar_kalici as object) }).dunyalarKalici).toBe(false);
    expect(parseInfo(FIX.info).dunyalarKalici).toBeUndefined();
  });
  it("sahte_sunucu_ayni_anahtarlari_verir", async () => {
    const { server, source } = canli();
    const kod = dunyaKur(server);
    skorEkle(server, kod, "a", "Ayşe", 3, 100);
    const anahtar = (x: unknown) => Object.keys(x as object).sort();
    const y = await source.dunyaYayinla!(TARIF, "Kıtlık", "Zor dünya", oyuncuKimligi());
    expect(anahtar(y)).toEqual(anahtar(FIX.dunya_yayinla));
    const ham = async (yol: string) => (await server.fetch(`http://x/api${yol}`)).json() as Promise<unknown>;
    expect(anahtar(await ham(`/dunyalar/${kod}`))).toEqual(anahtar(FIX.dunya_getir));
    expect(anahtar(((await ham(`/dunyalar?kurucu=${oyuncuKimligi()}`)) as unknown[])[0])).toEqual(anahtar((FIX.dunya_liste as unknown[])[0]));
    expect(anahtar(((await ham(`/dunyalar/${kod}/skor`)) as unknown[])[0])).toEqual(anahtar((FIX.dunya_skor as unknown[])[0]));
  });
});
