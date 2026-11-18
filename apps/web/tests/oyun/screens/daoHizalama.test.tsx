import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { DaoEkrani } from "@/oyun/screens/dao/DaoEkrani";
import { useDaoGozlem } from "@/oyun/screens/dao/useDaoGozlem";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { DaoGozlem } from "@/oyun/sim/dao";
import type { RunState, SimEvent, SimSource, WeekPacket } from "@/oyun/sim/types";
import { GOZLEM_AHIR } from "../helpers/daoVeri";
import { packetOf } from "../helpers/fakeLiveServer";
import { createFakeSource } from "../helpers/fakeSource";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

const ADLAR = ["Közlüdere", "Yaldızova", "Bakırbük", "Demirpınar", "Taşyaka"];
const durum = (over: Partial<RunState> = {}): RunState => ({
  runId: "r", status: "paused", week: 3, durationWeeks: 520, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "canli", name: "Dünya", cityNames: ADLAR, mode: "dao", ...over,
});
const hafta = (g: DaoGozlem): SimEvent => ({ type: "week", packet: { ...packetOf("r", g.hafta, 1), dao: g } as WeekPacket });

function kur(g: DaoGozlem, state: Partial<RunState>, ek: Record<string, unknown> = {}) {
  const src = createFakeSource([{ type: "state", state: durum({ week: g.hafta, ...state }) }, hafta(g)], { kind: "live" });
  Object.assign(src, { daoKarar: vi.fn(async () => ({ kabul: true as const, hafta: g.hafta + 1 })), daoGozlem: vi.fn(async () => g), ...ek });
  const r = render(
    <SimSourceProvider source={src}>
      <DaoEkrani route={{ name: "dao", runId: "r" }} />
    </SimSourceProvider>,
  );
  return { src, ...r };
}

beforeEach(() => {
  window.location.hash = "#/dao/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DaoKontrol hizalama", () => {
  it("kontrol_hatasi_yutulmaz_alert_gosterir", async () => {
    const { src } = kur(GOZLEM_AHIR, {});
    vi.spyOn(src, "control").mockRejectedValue(new SimUnsupported("hata.sunucu_yok"));
    fireEvent.click(await screen.findByRole("button", { name: "Bir hafta ilerle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("hata.sunucu_yok"));
  });

  it("kontrol_bilinmeyen_hata_genel_komut_metni", async () => {
    const { src } = kur(GOZLEM_AHIR, {});
    vi.spyOn(src, "control").mockRejectedValue(new Error("x"));
    fireEvent.click(await screen.findByRole("button", { name: "Bir hafta ilerle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("dao.hata.kontrol"));
  });

  it("hiz_sunucunun_soyledigi_deger_olarak_yazilir", async () => {
    kur(GOZLEM_AHIR, { speed: 16 });
    expect(await screen.findByText("Hız 16×")).toBeInTheDocument();
  });

  it("olay_sonrasi_onceki_hiz_pause_ve_speed_ile_geri_yuklenir", async () => {
    const { src } = kur(GOZLEM_AHIR, { speed: 1 });
    const control = vi.spyOn(src, "control").mockResolvedValue(durum({ speed: 16 }));
    fireEvent.click(await screen.findByRole("button", { name: "Bir şey olana kadar devam et" }));
    expect(control).toHaveBeenLastCalledWith("r", { action: "olay" });
    act(() => src.emit("r", { type: "state", state: durum({ speed: 16, status: "running" }) }));
    expect(control).toHaveBeenCalledTimes(1);
    act(() => src.emit("r", { type: "state", state: durum({ speed: 16, status: "paused", week: 4 }) }));
    await waitFor(() => expect(control).toHaveBeenLastCalledWith("r", { action: "pause", speed: 1 }));
    expect(control).toHaveBeenCalledTimes(2);
    // hız geri geldi: tekrar çağrılmaz
    act(() => src.emit("r", { type: "state", state: durum({ speed: 1, status: "paused", week: 4 }) }));
    expect(control).toHaveBeenCalledTimes(2);
  });

  it("olay_hizi_zaten_16_ise_geri_yukleme_yok", async () => {
    const { src } = kur(GOZLEM_AHIR, { speed: 16 });
    const control = vi.spyOn(src, "control").mockResolvedValue(durum({ speed: 16 }));
    fireEvent.click(await screen.findByRole("button", { name: "Bir şey olana kadar devam et" }));
    act(() => src.emit("r", { type: "state", state: durum({ speed: 16, status: "paused", week: 4 }) }));
    expect(control).toHaveBeenCalledTimes(1);
  });
});

describe("DaoKontrol olay geri yükleme sırası", () => {
  it("yanit_zaten_running_degilse_akis_beklenmeden_geri_yukler", async () => {
    const { src } = kur(GOZLEM_AHIR, { speed: 1 });
    const control = vi.spyOn(src, "control").mockResolvedValueOnce(durum({ speed: 16, status: "paused", week: 4 })).mockResolvedValue(durum({ speed: 1 }));
    fireEvent.click(await screen.findByRole("button", { name: "Bir şey olana kadar devam et" }));
    await waitFor(() => expect(control).toHaveBeenLastCalledWith("r", { action: "pause", speed: 1 }));
  });

  it("running_gorulmeden_gelen_paused_16_olayi_erken_geri_yuklemez", async () => {
    const { src } = kur(GOZLEM_AHIR, { speed: 1 });
    const control = vi.spyOn(src, "control").mockResolvedValue(durum({ speed: 16, status: "running" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bir şey olana kadar devam et" }));
    await waitFor(() => expect(control).toHaveBeenCalledTimes(1));
    act(() => src.emit("r", { type: "state", state: durum({ speed: 16, status: "paused" }) }));
    expect(control).toHaveBeenCalledTimes(1);
    act(() => src.emit("r", { type: "state", state: durum({ speed: 16, status: "running" }) }));
    act(() => src.emit("r", { type: "state", state: durum({ speed: 16, status: "paused", week: 5 }) }));
    await waitFor(() => expect(control).toHaveBeenLastCalledWith("r", { action: "pause", speed: 1 }));
  });
});

describe("useDaoGozlem", () => {
  const wrap = (source: SimSource) => {
    const Sarmal = ({ children }: { children: ReactNode }) => <SimSourceProvider source={source}>{children}</SimSourceProvider>;
    return Sarmal;
  };
  const kaynak = (daoGozlem: SimSource["daoGozlem"]): SimSource => Object.assign(createFakeSource([], { kind: "live" }), { daoGozlem });

  it("gecici_hatada_artan_aralikla_yeniden_dener_ve_duzelince_hata_temizlenir", async () => {
    vi.useFakeTimers();
    const oku = vi.fn()
      .mockRejectedValueOnce(new SimUnsupported("hata.sunucu_yok"))
      .mockRejectedValueOnce(new SimUnsupported("hata.sunucu_yok"))
      .mockResolvedValue(GOZLEM_AHIR);
    const { result } = renderHook(() => useDaoGozlem("r", durum(), []), { wrapper: wrap(kaynak(oku)) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.hata).toBe("hata.sunucu_yok");
    expect(oku).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
    expect(oku).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); }); // 1,5 sn
    expect(oku).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(2800); });
    expect(oku).toHaveBeenCalledTimes(2); // ikinci aralık 3 sn (1,5 sn'deki başarısızlıktan sonra: 4,5 sn)
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(oku).toHaveBeenCalledTimes(3);
    expect(result.current.gozlem).toEqual(GOZLEM_AHIR);
    expect(result.current.hata).toBeNull();
  });

  it("kalici_kodlarda_yeniden_denemez", async () => {
    vi.useFakeTimers();
    const oku = vi.fn().mockRejectedValue(new SimUnsupported("dao_degil"));
    const { result } = renderHook(() => useDaoGozlem("r", durum(), []), { wrapper: wrap(kaynak(oku)) });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(oku).toHaveBeenCalledTimes(1);
    expect(result.current.hata).toBe("dao_degil");
  });

  it("unmount_zamanlayiciyi_iptal_eder_ve_sonrasinda_cagri_olmaz", async () => {
    vi.useFakeTimers();
    const oku = vi.fn().mockRejectedValue(new SimUnsupported("hazirlaniyor"));
    const { result, unmount } = renderHook(() => useDaoGozlem("r", durum(), []), { wrapper: wrap(kaynak(oku)) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.hazirlaniyor).toBe(true);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(oku).toHaveBeenCalledTimes(1);
  });

  it("yanit_unmount_sonrasi_gelirse_durum_yazilmaz", async () => {
    let coz!: (g: DaoGozlem) => void;
    const oku = vi.fn(() => new Promise<DaoGozlem>((r) => { coz = r; }));
    const { unmount } = renderHook(() => useDaoGozlem("r", durum(), []), { wrapper: wrap(kaynak(oku)) });
    unmount();
    await act(async () => { coz(GOZLEM_AHIR); });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("paketteki_dao_varsa_agdan_okumaz", () => {
    const oku = vi.fn();
    const pk = { ...packetOf("r", 3, 1), dao: GOZLEM_AHIR } as WeekPacket;
    const { result } = renderHook(() => useDaoGozlem("r", durum(), [pk]), { wrapper: wrap(kaynak(oku)) });
    expect(result.current.gozlem).toBe(GOZLEM_AHIR);
    expect(oku).not.toHaveBeenCalled();
  });
});
