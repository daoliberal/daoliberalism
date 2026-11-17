import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplaySource as realCreate } from "@/oyun/sim/replay";
import { useRestoreRun } from "@/oyun/hooks/useRestoreRun";
import { useRun } from "@/oyun/sim/useRun";
import { fakeTimer } from "./helpers/replayFixture";
import { OyunApp } from "@/oyun/OyunApp";
import { t } from "@/oyun/copy/t";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { SimEvent, SimSource } from "@/oyun/sim/types";
import { encodeRunId } from "@/oyun/sim/replay/runId";
import { createFakeSource } from "./helpers/fakeSource";
import { allFiles, makeFetch } from "./helpers/replayFixture";

// P-04: kaynak seçimi artık asenkron yoklar; bu test dosyası kayıt kaynağıyla çalışır (sunucu yok).
vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

type Spy = { sources: SimSource[]; disposes: number[]; opens: string[] };
const spy = vi.hoisted((): Spy => ({ sources: [], disposes: [], opens: [] }));

vi.mock("@/oyun/sim/replay", async (orig) => {
  const real = await orig<typeof import("@/oyun/sim/replay")>();
  return {
    ...real,
    createReplaySource: (o: Parameters<typeof real.createReplaySource>[0]) => {
      const s = real.createReplaySource(o);
      const n = spy.sources.length;
      spy.sources.push(s);
      return new Proxy(s, {
        get(t, k) {
          if (k === "dispose") return () => (spy.disposes.push(n), t.dispose());
          if (k === "open") return (id: string) => (spy.opens.push(`${n}:${id}`), t.open(id));
          const v = Reflect.get(t, k) as unknown;
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        },
      });
    },
  };
});

const files = Object.fromEntries(Object.entries(allFiles()).map(([k, v]) => [k.replace("/k/", "/oyun-kayit/"), v]));
const VALID = encodeRunId({ setId: "kapali", seedIndex: 0, changes: [], name: "E", cityNames: ["a", "b", "c", "d", "e"] });
let fetchMock: ReturnType<typeof makeFetch>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spy.sources.length = 0;
  spy.disposes.length = 0;
  spy.opens.length = 0;
  fetchMock = makeFetch(files);
  vi.stubGlobal("fetch", fetchMock);
  window.location.hash = "";
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  errSpy.mockRestore();
});

/** "Olmadı" iddiasından önce bekleyen bütün zamanlayıcı ve mikro görevleri belirlenimli boşaltır (gerçek bekleme yok). */
async function settle(): Promise<void> {
  vi.useFakeTimers();
  try {
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  } finally {
    vi.useRealTimers();
  }
}

describe("OyunApp kaynak", () => {
  it("acilinca_iskelet_ve_index_istenir", async () => {
    render(<OyunApp />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(spy.sources).toHaveLength(1));
    window.location.hash = `#/canli/${encodeURIComponent(VALID)}`;
    await waitFor(() => expect(fetchMock.calls).toContain("/oyun-kayit/index.json"));
  });

  it("unmount_dispose_bir_kez", async () => {
    const { unmount } = render(<OyunApp />);
    await waitFor(() => expect(spy.sources).toHaveLength(1));
    expect(spy.disposes).toEqual([]);
    unmount();
    expect(spy.disposes).toEqual([0]);
  });

  it("yeniden_cizimde_kaynak_iki_kez_kurulmaz", async () => {
    const { rerender } = render(<OyunApp />);
    rerender(<OyunApp />);
    rerender(<OyunApp />);
    await waitFor(() => expect(spy.sources).toHaveLength(1));
    await settle();
    expect(spy.sources).toHaveLength(1);
  });

  it("strictmode_ilk_kaynak_dispose_son_kaynak_canli", async () => {
    window.location.hash = `#/canli/${VALID}`;
    const { unmount } = render(<StrictMode><OyunApp /></StrictMode>);
    // Kaynak yoklamadan sonra kurulur: iptal edilen ilk effect kaynak kurmaz, yalnız son effect'in kaynağı canlıdır.
    await waitFor(() => expect(spy.opens.length).toBeGreaterThan(0));
    expect(spy.sources).toHaveLength(1);
    expect(spy.disposes).toEqual([]);
    expect(spy.opens.every((o) => o.startsWith("0:"))).toBe(true);
    await waitFor(() => expect(fetchMock.calls.some((u) => u.endsWith("pm0.json"))).toBe(true));
    unmount();
    expect(spy.disposes).toEqual([0]);
  });

  it("canli_gecerli_tarif_open_cagirir", async () => {
    window.location.hash = `#/canli/${VALID}`;
    render(<OyunApp />);
    await waitFor(() => expect(spy.opens).toEqual([`0:${VALID}`]));
  });

  it("canli_cop_missing_konsol_temiz", async () => {
    window.location.hash = "#/canli/çöp";
    render(<OyunApp />);
    await waitFor(() => expect(spy.opens).toHaveLength(1));
    await settle();
    expect(errSpy).not.toHaveBeenCalled();
  });
});

function setup(runId: string | null, opts?: Parameters<typeof createFakeSource>[1], script: SimEvent[] = []) {
  const src = createFakeSource(script, { runId: "r", ...opts });
  const wrapper = ({ children }: { children: ReactNode }) => <SimSourceProvider source={src}>{children}</SimSourceProvider>;
  const hook = renderHook(({ id }: { id: string | null }) => useRestoreRun(id), { wrapper, initialProps: { id: runId } });
  return { src, ...hook };
}

describe("useRestoreRun", () => {
  it("null_idle_open_yok", () => {
    const { src, result } = setup(null);
    expect(result.current).toMatchObject({ status: "idle", handle: null });
    expect(src.opens).toBe(0);
  });

  it("gecerli_ready", async () => {
    const { src, result } = setup("r");
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.handle?.runId).toBe("r");
    expect(src.opens).toBe(1);
  });

  it("bilinmeyen_missing", async () => {
    const { result } = setup("yok");
    await waitFor(() => expect(result.current.status).toBe("missing"));
    expect(result.current.handle).toBeNull();
  });

  it("start_sonrasi_adopt_ile_go_open_cagirmaz", async () => {
    const { src, result, rerender } = setup(null);
    await act(async () => {
      const h = await src.start({ name: "n", cityNames: [], templateId: "t", durationWeeks: 200, seedIndex: 0, values: {} });
      result.current.adopt(h);
    });
    rerender({ id: "r" });
    expect(result.current.status).toBe("ready");
    expect(src.opens).toBe(0);
  });

  it("state_olayiyla_bildirilen_alias_open_cagirmaz_ve_abonelik_surer", async () => {
    const { src, result, rerender } = setup("r", { aliases: { r2: "r" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => {
      src.emit("r", { type: "state", state: { ...result.current.handle!.state, runId: "r2" } });
    });
    rerender({ id: "r2" });
    expect(result.current.status).toBe("ready");
    expect(src.opens).toBe(1);
    expect(src.activeSubscriptions).toBe(1);
  });

  it("dis_hash_degisimi_eski_abonelik_kapanir_open_bir_kez", async () => {
    const { src, result, rerender } = setup("r", { aliases: { baska: "r" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(src.activeSubscriptions).toBe(1);
    rerender({ id: "baska" });
    await waitFor(() => expect(src.opens).toBe(2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(src.activeSubscriptions).toBe(1);
  });

  it("unmount_aboneligi_kapatir", async () => {
    const { src, result, unmount } = setup("r");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    unmount();
    expect(src.activeSubscriptions).toBe(0);
  });

  it("gercek_kaynakla_yenileme_hafta0_duraklatilmis", async () => {
    const real = realCreate({ baseUrl: "/oyun-kayit/", fetchImpl: fetchMock });
    const wrapper = ({ children }: { children: ReactNode }) => <SimSourceProvider source={real}>{children}</SimSourceProvider>;
    const { result } = renderHook(() => useRestoreRun(VALID), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.handle?.state).toMatchObject({ week: 0, status: "paused", seedIndex: 0, scenarioId: "kapali" });
    real.dispose();
  });
});

describe("useRestoreRun + useRun: son inceleme", () => {
  it("W1 3(b): replace ile alias runId'ye geçişte open çağrılmaz ve useRun.weeks korunur", async () => {
    const wkp = (week: number): SimEvent => ({ type: "week", packet: { v: 1, run_id: "r", week, version: 1, world: {} as never, events: [] } });
    const src = createFakeSource([wkp(1), wkp(2)], { runId: "r", aliases: { r2: "r" } });
    const wrapper = ({ children }: { children: ReactNode }) => <SimSourceProvider source={src}>{children}</SimSourceProvider>;
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => {
        const restore = useRestoreRun(id);
        const run = useRun(restore.status === "ready" ? "r" : null);
        return { restore, run };
      },
      { wrapper, initialProps: { id: "r" } },
    );
    await waitFor(() => expect(result.current.restore.status).toBe("ready"));
    expect(result.current.run.weeks).toHaveLength(2);
    act(() => src.emit("r", { type: "state", state: { ...result.current.restore.handle!.state, runId: "r2" } }));
    rerender({ id: "r2" });
    expect(src.opens).toBe(1);
    expect(result.current.restore.status).toBe("ready");
    expect(result.current.run.weeks).toHaveLength(2);
  });

  it("I3: Kurucu'ya dönünce (runId null) restore aboneliği kapanır", async () => {
    const { src, result, rerender } = setup("r");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(src.activeSubscriptions).toBe(1);
    rerender({ id: null });
    expect(src.activeSubscriptions).toBe(0);
    rerender({ id: "r" });
    expect(src.activeSubscriptions).toBe(1);
    expect(src.opens).toBe(1);
  });

  it("I3: yabancı hash yüklenirken eski abonelik açık kalmaz", async () => {
    const { src, result, rerender } = setup("r", { aliases: { baska: "r" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ id: "baska" });
    expect(result.current.status).toBe("loading");
    expect(src.activeSubscriptions).toBe(0);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(src.activeSubscriptions).toBe(1);
  });

  it("I3: gerçek kaynakla Kurucu'ya dönünce oynayan koşu durur, haftalar ilerlemez", async () => {
    const timer = fakeTimer();
    const real = realCreate({ baseUrl: "/oyun-kayit/", fetchImpl: fetchMock, timer });
    const wrapper = ({ children }: { children: ReactNode }) => <SimSourceProvider source={real}>{children}</SimSourceProvider>;
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useRestoreRun(id), { wrapper, initialProps: { id: VALID as string | null } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const id = result.current.handle!.runId;
    await real.control(id, { action: "play" });
    timer.advance(600 * 3);
    expect((await real.weeks(id, 1, 200)).length).toBe(3);
    rerender({ id: null });
    timer.advance(600 * 10);
    expect((await real.weeks(id, 1, 200)).length).toBe(3);
    expect((await real.control(id, { action: "pause" })).status).toBe("paused");
    real.dispose();
  });
});

describe("OyunApp: giriş rotaları (DK-14)", () => {
  it("bos_adres_baslangic_acar_ust_cubuk_yok", async () => {
    render(<OyunApp />);
    expect(await screen.findByRole("button", { name: t("baslangic.kurucu_dugme") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: t("baslangic.baslik") })).toBeInTheDocument();
    expect(screen.getByText(t("baslangic.alt_baslik"))).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: t("ustcubuk.menu") })).toBeNull();
  });

  it("baslangic_tam_ekran_giris_kabugunda_uc_kart_ve_soluk_zemin", async () => {
    const { container } = render(<OyunApp />);
    await screen.findByRole("button", { name: t("baslangic.kurucu_dugme") });
    // Tam ekran giriş kabuğu: arkada dekoratif soluk şehir (erişilebilirlik ağacında yok, etkileşimsiz), üç kart.
    expect(container.querySelector("[data-giris-kabi]")).not.toBeNull();
    const zemin = screen.getByTestId("soluk-sehir-zemini");
    expect(zemin).toHaveAttribute("aria-hidden", "true");
    expect(zemin.querySelector("a, button, input, [tabindex]")).toBeNull();
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-labelledby"))).toEqual(["baslangic-kurucu", "baslangic-dao", "baslangic-evren"]);
    // Başlangıçta Geri yok (marka var); tema düğmesi kabuktadır.
    expect(screen.queryByRole("button", { name: t("giris.geri") })).toBeNull();
    expect(screen.getByRole("button", { name: t("ustcubuk.tema_koyu") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("baslangic.yakinda") })).toBeDisabled();
  });

  it("giris_kabugundaki_tema_dugmesi_temayi_degistirir", async () => {
    render(<OyunApp />);
    const dugme = await screen.findByRole("button", { name: t("ustcubuk.tema_koyu") });
    fireEvent.click(dugme);
    await waitFor(() => expect(screen.getByRole("button", { name: t("ustcubuk.tema_acik") })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: t("ustcubuk.tema_acik") }));
    await waitFor(() => expect(screen.getByRole("button", { name: t("ustcubuk.tema_koyu") })).toBeInTheDocument());
  });

  it("dao_adresi_dao_girisini_acar", async () => {
    window.location.hash = "#/dao";
    render(<OyunApp />);
    expect(await screen.findByRole("heading", { name: t("dao.giris.baslik") })).toBeInTheDocument();
    expect(screen.getByText(t("dao.sunucu_yok"))).toBeInTheDocument(); // kayıt kaynağında oyun sunucusu yok
  });

  it("dao_girisi_ve_kurucu_giris_kabugunda_geri_baslangica_doner", async () => {
    for (const adres of ["#/dao", "#/kurucu"]) {
      window.location.hash = adres;
      const { container, unmount } = render(<OyunApp />);
      await screen.findByRole("button", { name: t("giris.geri") });
      expect(container.querySelector("[data-giris-kabi]")).not.toBeNull();
      expect(screen.getByTestId("soluk-sehir-zemini")).toHaveAttribute("aria-hidden", "true");
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: t("giris.geri") }));
      expect(window.location.hash).toBe("#/");
      unmount();
    }
  });

  it("paylasilan_dunya_adresi_kayit_kaynaginda_sunucu_yok_der", async () => {
    window.location.hash = "#/dao/d/K7M2QXA";
    render(<OyunApp />);
    expect(await screen.findByText(t("dao.sunucu_yok"))).toBeInTheDocument(); // kayıt kaynağında paylaşılan dünya yok
  });

  it("kurucu_adresi_kurucuyu_giris_kabugunda_acar", async () => {
    window.location.hash = "#/kurucu";
    render(<OyunApp />);
    expect(await screen.findByRole("heading", { name: t("kurucu.baslik") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("giris.geri") })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: t("ustcubuk.menu") })).toBeNull(); // üst çubuk koşu ekranlarına ait
  });

  // W12: rehberli adres artık "henüz hazır değil" bilgisini değil, üç adımlı ilk oyunu açar (bilinçli davranış değişikliği).
  it("rehberli_adres_ilk_oyunu_acar", async () => {
    window.location.hash = "#/kurucu/rehberli";
    render(<OyunApp />);
    expect(await screen.findByText(t("rehber.bilgi"))).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: t("rehber.baslik") })).toBeInTheDocument();
    expect(screen.queryByText(t("baslangic.rehberli_bilgi"))).toBeNull();
  });

  it("old_live_links_work", async () => {
    window.location.hash = `#/canli/${VALID}`;
    render(<OyunApp />);
    await waitFor(() => expect(spy.opens).toEqual([`0:${VALID}`]));
    const opens = spy.opens.length;
    // Kurucu şehir ekranı kendi üst şeridini taşır: ayrı üst çubuk (ana menü gezintisi) yoktur.
    expect(await screen.findByRole("region", { name: t("ekran.ana") })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: t("ustcubuk.menu") })).toBeNull();
    window.location.hash = `#/canli/${VALID}/zincir`;
    await settle();
    // görünüm eki aynı koşuyu yeniden açmaz; koşu ekranı (saat çubuğu) yerinde kalır, Zincir Ayrıntılar penceresinin sekmesidir
    expect(spy.opens.length).toBe(opens);
    expect(screen.getByRole("group", { name: t("canli.hiz_grup") })).toBeInTheDocument();
  });

  it("eski_dunya_ve_harita_baglantilari_sehir_ekranina_yonlenir", async () => {
    for (const eski of ["dunya", "harita"]) {
      window.location.hash = `#/canli/${VALID}/${eski}`;
      render(<OyunApp />);
      await waitFor(() => expect(window.location.hash).toBe(`#/canli/${VALID}`));
      expect(await screen.findByRole("region", { name: t("ekran.ana") })).toBeInTheDocument();
      cleanup();
    }
  });

  // W11: `#/kosular` artık gerçek Koşular ekranıdır (yer tutucu kalktı); kütüphane boşken boş durum ve Ağaç/aktarma bölümleri görünür.
  it("kosular_adresi_kosular_ekranini_acar", async () => {
    window.location.hash = "#/kosular";
    render(<OyunApp />);
    expect(await screen.findByRole("heading", { name: t("kosular.baslik") })).toBeInTheDocument();
    expect(screen.queryByText(t("ustcubuk.yakinda"))).toBeNull();
    expect(screen.getByText(t("kosular.kayitli.yok"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("kosular.agac.baslik") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("kosular.aktar.baslik") })).toBeInTheDocument();
  });

  // W10: `#/sonuc/<koşu>` artık gerçek Sonuç ekranıdır (yer tutucu kalktı); koşu hafta 0'dayken "Ara durum" başlığı görünür.
  it("sonuc_adresi_sonuc_ekranini_acar", async () => {
    window.location.hash = `#/sonuc/${VALID}`;
    render(<OyunApp />);
    expect(await screen.findByRole("heading", { name: t("sonuc.baslik.ara", { n: 0, toplam: 200 }) })).toBeInTheDocument();
    expect(screen.queryByText(t("ustcubuk.yakinda"))).toBeNull();
    expect(screen.getByRole("button", { name: t("sonuc.canli") })).toBeInTheDocument();
  });

  it("hareket_dugmesi_kokte_data_hareket_yazar", async () => {
    window.location.hash = "#/kurucu";
    const { container } = render(<OyunApp />);
    const d = await screen.findByRole("button", { name: t("ustcubuk.hareket_azalt") });
    expect(container.querySelector("[data-hareket]")).toBeNull();
    fireEvent.click(d);
    await waitFor(() => expect(container.querySelector('[data-hareket="azalt"]')).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: t("ustcubuk.hareket_azaltildi") }));
    await waitFor(() => expect(container.querySelector("[data-hareket]")).toBeNull());
  });
});

describe("OyunApp şehir rotası", () => {
  it("gorsel_gizli_logo_baglantisi_tab_siresinde_degil", async () => {
    window.location.hash = `#/canli/${VALID}/0`;
    const { container } = render(<OyunApp />);
    await waitFor(() => expect(spy.sources).toHaveLength(1));
    const logo = container.querySelector('a[href="/"]');
    expect(logo).not.toBeNull();
    expect(logo!.closest("[inert]")).not.toBeNull();
  });
});
