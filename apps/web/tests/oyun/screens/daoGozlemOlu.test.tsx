import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDaoGozlem } from "@/oyun/screens/dao/useDaoGozlem";
import { SimUnsupported, type SimSource } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunState } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";

const durum = (status: RunState["status"], week = 0, dao0?: object): RunState =>
  ({ runId: "canli-3f8632e5", status, week, ...(dao0 ? { dao0 } : {}), durationWeeks: 200, speed: 1, computing: false, version: 2, seedIndex: 0, values: {}, scenarioId: "x", name: "Ada", cityNames: [] }) as RunState;

function kur(sorgu: () => Promise<never>, status: RunState["status"], week = 0, dao0?: object) {
  const base = createFakeSource([]);
  const source = { ...base, daoGozlem: sorgu } as unknown as SimSource;
  const sarmal = ({ children }: { children: ReactNode }) => <SimSourceProvider source={source}>{children}</SimSourceProvider>;
  return renderHook(({ s }: { s: RunState }) => useDaoGozlem("canli-3f8632e5", s, []), { wrapper: sarmal, initialProps: { s: durum(status, week, dao0) } });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDaoGozlem: ölü koşu", () => {
  it("hazirlaniyor_yaniti_suren_canli_kosuda_yoklama_surer", async () => {
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "running", 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(sorgu.mock.calls.length).toBeGreaterThan(2);
    expect(result.current.hazirlaniyor).toBe(true);
  });

  it("failed_kosuda_yoklama_hic_baslamaz_ve_anlasilir_hata_doner", async () => {
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "failed");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(sorgu).not.toHaveBeenCalled();
    expect(result.current.hata).toBe("kosu_coktu");
    expect(result.current.hazirlaniyor).toBe(false);
  });

  it("yoklama_sirasinda_kosu_failed_olursa_durur", async () => {
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result, rerender } = kur(sorgu, "running", 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    const n = sorgu.mock.calls.length;
    rerender({ s: durum("failed") });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(sorgu.mock.calls.length).toBe(n);
    expect(result.current.hata).toBe("kosu_coktu");
  });

  it("sunucu_hazirlaniyor_deyip_paket_yayimlamayan_kosuda_yoklama_sinirlidir", async () => {
    // Sunucu çökmüş işçiyi hâlâ "hazirlaniyor" diye yanıtlar: sonsuza dek 409 yağdırmak yerine yoklama vazgeçer.
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "running", 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    const n = sorgu.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(sorgu.mock.calls.length).toBe(n);
    expect(n).toBeLessThanOrEqual(60);
    expect(result.current.hata).toBe("kosu_yanit_vermiyor");
    expect(result.current.hazirlaniyor).toBe(false);
  });

  it("hafta0_duran_kosuda_tek_yoklama_hata_yok_ipucu_ezilmez", async () => {
    // Oyuncu henüz oynat'a basmadı: sunucunun ilk paketi yoktur, "hazirlaniyor" meşrudur; yoklama sürmez, hata üretilmez.
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "paused", 0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(sorgu).toHaveBeenCalledTimes(1);                       // tek yoklama: DAO olmayan koşu (dao_degil) yine anlaşılır
    expect(result.current.hata).toBeNull();
    expect(result.current.hazirlaniyor).toBe(false);
  });

  it("hafta0_dao0_varken_hic_yoklama_yok", async () => {
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "paused", 0, { hafta: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(sorgu).not.toHaveBeenCalled();
    expect(result.current.gozlem).not.toBeNull();
  });

  it("hafta0_dururken_oynat_basilinca_yoklama_baslar_ve_sinir_yalniz_running_iken_sayilir", async () => {
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result, rerender } = kur(sorgu, "paused", 0);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(sorgu).toHaveBeenCalledTimes(1);
    rerender({ s: durum("running", 0) });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(sorgu.mock.calls.length).toBeGreaterThan(3);
    expect(result.current.hazirlaniyor).toBe(true);
  });

  it("hafta3_paused_kosuda_hazirlaniyor_yoklamasi_sinirlidir_sonsuz_degil", async () => {
    // Y1: hafta > 0 iken duraklatılmış koşuda da çökmüş işçi sonsuz 409 yağdırmasın (sınır yalnız hazırlık işareti yokken sayılır).
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "paused", 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    const n = sorgu.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(sorgu.mock.calls.length).toBe(n);
    expect(n).toBeLessThanOrEqual(60);
    expect(result.current.hata).toBe("kosu_yanit_vermiyor");
    expect(result.current.hazirlaniyor).toBe(false);
  });

  it("hafta10_paketsiz_yenilemede_hafta0_gozlemi_(dao0)_gosterilmez_ve_GET_dao_yoklamasi_kapanmaz", async () => {
    // B10 Y-yeni-1: yenilemeden sonra durum (hafta 10, dao0 hafta 0'dan) paketlerden once gelir; eski gozlem guncel diye gosterilmemeli.
    const dao0 = { hafta: 0, ben: { durum: "ahir" } };
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "running", 10, dao0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(sorgu).toHaveBeenCalled();                  // yoklama kapanmadi
    expect(result.current.gozlem).toBeNull();          // hafta 0 degeri gosterilmedi
    expect(result.current.hazirlaniyor).toBe(true);
  });

  it("hafta0_dao0_hala_kullanilir_ve_yoklama_gerekmez", async () => {
    const dao0 = { hafta: 0, ben: { durum: "ahir" } };
    const sorgu = vi.fn(() => Promise.reject(new SimUnsupported("hazirlaniyor")));
    const { result } = kur(sorgu, "paused", 0, dao0);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(sorgu).not.toHaveBeenCalled();
    expect(result.current.gozlem).toBe(dao0);
  });
});
