import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { DaoBen } from "@/oyun/screens/dao/DaoBen";
import { IsletmeKurEylemi, type KararDurumu } from "@/oyun/screens/dao/DaoKararlar";
import type { DaoAdlar } from "@/oyun/sim/dao";
import { GOZLEM_CALISAN, GOZLEM_KURUCU } from "../helpers/daoVeri";

const ad: DaoAdlar = { sehir: (i) => `Sehir ${i}`, sektor: (s) => s, firma: (k) => k };
const karar = (gonder: KararDurumu["gonder"]): KararDurumu => ({ gonder, mesgul: false, kapali: false, kabul: null, ret: null, sirada: null });
afterEach(cleanup);

describe("K8: secilen parsel ve isletmeni goster", () => {
  it("kur_kabul_edilince_secilen_parsel_ve_sektorle_onKur_cagrilir", async () => {
    const onKur = vi.fn();
    const gonder = vi.fn(async () => true);
    render(<IsletmeKurEylemi g={GOZLEM_CALISAN.kurabilir.evet ? GOZLEM_CALISAN : { ...GOZLEM_CALISAN, kurabilir: { ...GOZLEM_CALISAN.kurabilir, evet: true, eksikler: [] } }} ad={ad} k={karar(gonder)} parsel="p3_4" onKur={onKur} />);
    fireEvent.click(screen.getByRole("button", { name: t("dao.karar.kur") }));
    await waitFor(() => expect(onKur).toHaveBeenCalledWith("p3_4", expect.any(String)));
    expect(gonder).toHaveBeenCalledWith({ tur: "kur", sektor: expect.any(String) });
  });
  it("kur_reddedilirse_parsel_sabitlenmez", async () => {
    const onKur = vi.fn();
    const gonder = vi.fn(async () => false);
    render(<IsletmeKurEylemi g={{ ...GOZLEM_CALISAN, kurabilir: { ...GOZLEM_CALISAN.kurabilir, evet: true, eksikler: [] } }} ad={ad} k={karar(gonder)} parsel="p3_4" onKur={onKur} />);
    fireEvent.click(screen.getByRole("button", { name: t("dao.karar.kur") }));
    await waitFor(() => expect(gonder).toHaveBeenCalled());
    expect(onKur).not.toHaveBeenCalled();
  });
  it("isletmeni_goster_yalniz_kurucuda_ve_tiklaninca_cagrilir", () => {
    const onGoster = vi.fn();
    render(<DaoBen g={GOZLEM_KURUCU} ad={ad} onIsletmeyiGoster={onGoster} />);
    fireEvent.click(screen.getByRole("button", { name: "İşletmeni göster" }));
    expect(onGoster).toHaveBeenCalledTimes(1);
    cleanup();
    render(<DaoBen g={GOZLEM_CALISAN} ad={ad} onIsletmeyiGoster={onGoster} />);
    expect(screen.queryByRole("button", { name: "İşletmeni göster" })).toBeNull();
  });
});
