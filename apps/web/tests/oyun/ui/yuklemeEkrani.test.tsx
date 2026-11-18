import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { AcilisDurumu } from "@/oyun/tarayici/kaynak";
import { tahminiOynatma } from "@/oyun/tarayici/kayit/siniflandirma";
import type { AkisSonucu } from "@/oyun/tarayici/kayit/akis";
import { YuklemeEkrani } from "@/oyun/ui/YuklemeEkrani";

afterEach(cleanup);

type DO = Extract<AcilisDurumu, { tur: "devam_olmadi" }>;
const TAHMIN = tahminiOynatma(20);

function devamOlmadi(sonuc: Exclude<AkisSonucu, { sonuc: "tamam" }>, ek: Partial<DO> = {}): DO {
  return {
    tur: "devam_olmadi",
    sonuc,
    kosuId: "canli-a1",
    yeni: vi.fn(),
    tariftenOynat: vi.fn(),
    yenidenYukle: vi.fn(),
    disaAktar: vi.fn(async () => ({ ad: "k.json", metin: "{}" })),
    sil: vi.fn(async () => undefined),
    ...ek,
  };
}
const uyumsuz = (tur: "surum" | "guvensiz" | "bozuk"): Exclude<AkisSonucu, { sonuc: "tamam" }> => ({ sonuc: "uyumsuz", tur, fark: {}, hedef: 20, tahmini: TAHMIN, secenekler: ["tariften_oynat", "disa_aktar", "sil"] });

describe("YuklemeEkrani: devam_olmadi secimleri", () => {
  it("uyumsuz_surum_metin_tahmini_sure_ve_dort_secenek", async () => {
    const d = devamOlmadi(uyumsuz("surum"));
    render(<YuklemeEkrani durum={d} indir={vi.fn()} />);
    expect(screen.getByRole("heading", { name: t("acilis.uyumsuz.surum.baslik") })).toBeVisible();
    expect(screen.getByText(t("acilis.uyumsuz.surum.bilgi"))).toBeVisible();
    expect(screen.getByText(t("acilis.tahmin", { hafta: 20, enaz: t("tarayici.sure.sn", { n: 30 }), encok: t("tarayici.sure.dk", { n: 2 }) }))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("acilis.dugme.tariften") }));
    expect(d.tariftenOynat).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.secim.yeni") }));
    expect(d.yeni).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: t("acilis.dugme.disa") })).toBeVisible();
    expect(screen.getByRole("button", { name: t("acilis.dugme.sil") })).toBeVisible();
  });

  it("guvensiz_ve_bozuk_ve_tariften_gerek_kendi_metinleri", () => {
    for (const [sonuc, baslik] of [
      [uyumsuz("guvensiz"), "acilis.uyumsuz.guvensiz.baslik"],
      [uyumsuz("bozuk"), "acilis.uyumsuz.bozuk.baslik"],
      [{ sonuc: "tariften_gerek", neden: "goruntu_cok_eski", hedef: 40, tahmini: TAHMIN } as const, "acilis.tariften.baslik"],
    ] as const) {
      const { unmount } = render(<YuklemeEkrani durum={devamOlmadi(sonuc)} indir={vi.fn()} />);
      expect(screen.getByRole("heading", { name: t(baslik) })).toBeVisible();
      unmount();
    }
  });

  it("durdu_icin_baştan_oynat_dugmesi_YOK_disa_aktar_sil_yeni_var_K9", () => {
    render(<YuklemeEkrani durum={devamOlmadi({ sonuc: "durdu", durum: "reddedildi", kosuId: "canli-a1", cekirdek: {} as never, kosuSilinebilir: true })} indir={vi.fn()} />);
    expect(screen.getByText(t("acilis.durdu.reddedildi"))).toBeVisible();
    expect(screen.queryByRole("button", { name: t("acilis.dugme.tariften") })).toBeNull();
    expect(screen.getByRole("button", { name: t("acilis.dugme.disa") })).toBeVisible();
    expect(screen.getByRole("button", { name: t("acilis.dugme.sil") })).toBeVisible();
    expect(screen.getByRole("button", { name: t("tarayici.secim.yeni") })).toBeVisible();
  });

  it("hata_yeniden_yukle_dugmesi_ve_hata_turu_metinde", async () => {
    const d = devamOlmadi({ sonuc: "hata", tur: "ValueError", mesaj: "x" });
    render(<YuklemeEkrani durum={d} indir={vi.fn()} />);
    expect(screen.getByText(t("acilis.hata.bilgi", { tur: "ValueError" }))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.yeniden_yukle") }));
    expect(d.yenidenYukle).toHaveBeenCalledOnce();
  });

  it("disa_aktar_dosyayi_indirir_ve_bilgi_verir_hata_alert", async () => {
    const indir = vi.fn();
    const d = devamOlmadi(uyumsuz("surum"));
    render(<YuklemeEkrani durum={d} indir={indir} />);
    await userEvent.click(screen.getByRole("button", { name: t("acilis.dugme.disa") }));
    await waitFor(() => expect(indir).toHaveBeenCalledWith("k.json", "{}"));
    expect(await screen.findByText(t("acilis.disa_tamam"))).toBeVisible();
    cleanup();
    const d2 = devamOlmadi(uyumsuz("surum"), { disaAktar: vi.fn(async () => Promise.reject(new Error("x"))) });
    render(<YuklemeEkrani durum={d2} indir={indir} />);
    await userEvent.click(screen.getByRole("button", { name: t("acilis.dugme.disa") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("acilis.disa_hata"));
  });

  it("sil_iki_adimli_onay_ister_sonra_cagrilir_hata_olursa_mesaj_gosterir", async () => {
    const d = devamOlmadi(uyumsuz("surum"));
    render(<YuklemeEkrani durum={d} indir={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: t("acilis.dugme.sil") }));
    expect(d.sil).not.toHaveBeenCalled();
    expect(screen.getByText(t("acilis.sil_onay"))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("acilis.sil_vazgec") }));
    expect(screen.queryByText(t("acilis.sil_onay"))).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("acilis.dugme.sil") }));
    await userEvent.click(screen.getByRole("button", { name: t("acilis.sil_evet") }));
    expect(d.sil).toHaveBeenCalledOnce();
    cleanup();
    const d2 = devamOlmadi(uyumsuz("surum"), { sil: vi.fn(async () => Promise.reject(new Error("x"))) });
    render(<YuklemeEkrani durum={d2} indir={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: t("acilis.dugme.sil") }));
    await userEvent.click(screen.getByRole("button", { name: t("acilis.sil_evet") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("acilis.sil_hata"));
  });
});

describe("YuklemeEkrani: devam ilerlemesi, tahmin, uzun sure, iptal", () => {
  it("hafta_x_y_tahmin_ve_iptal_dugmesi", async () => {
    const iptal = vi.fn();
    render(<YuklemeEkrani durum={{ tur: "devam", hafta: 7, hedef: 20, tahmini: TAHMIN, uzun: false, iptal }} indir={vi.fn()} />);
    expect(screen.getByText(t("tarayici.devam.ilerleme", { hafta: 7, hedef: 20 }))).toBeVisible();
    expect(screen.getByText(t("tarayici.devam.tahmin", { enaz: t("tarayici.sure.sn", { n: 30 }), encok: t("tarayici.sure.dk", { n: 2 }) }))).toBeVisible();
    expect(screen.queryByText(t("tarayici.devam.uzun"))).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("tarayici.devam.iptal") }));
    expect(iptal).toHaveBeenCalledOnce();
  });

  it("uzun_isaretliyse_birkac_dakika_uyarisi_iptal_yoksa_dugme_yok", () => {
    render(<YuklemeEkrani durum={{ tur: "devam", hafta: 0, hedef: 39, uzun: true }} indir={vi.fn()} />);
    expect(screen.getByText(t("tarayici.devam.uzun"))).toBeVisible();
    expect(screen.queryByRole("button", { name: t("tarayici.devam.iptal") })).toBeNull();
  });
});

describe("YuklemeEkrani: surum_yukleniyor (B7 devri)", () => {
  it("notr_dogru_surum_yukleniyor_ekrani_devam_edilemedi_gostermez", () => {
    render(<YuklemeEkrani durum={{ tur: "surum_yukleniyor" }} indir={vi.fn()} />);
    expect(screen.getByRole("heading", { name: t("tarayici.surum_yukleniyor.baslik") })).toBeVisible();
    expect(screen.getByText(t("tarayici.surum_yukleniyor.bilgi"))).toBeVisible();
    expect(screen.queryByText(t("acilis.hata.baslik"))).toBeNull();
  });
});

describe("B8 Ö6: odak", () => {
  it("secim_ekrani_acilinca_baslik_odak_alir_silme_onayinda_Vazgec", async () => {
    render(<YuklemeEkrani durum={devamOlmadi(uyumsuz("surum"))} indir={vi.fn()} />);
    expect(screen.getByRole("heading", { name: t("acilis.uyumsuz.surum.baslik") })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: t("acilis.dugme.sil") }));
    expect(screen.getByRole("button", { name: t("acilis.sil_vazgec") })).toHaveFocus();
  });
});

describe("B8 tur 2 r1-O1", () => {
  it("acma_nedeniyle_bekleme_ekrani_surum_metni_degil_oyun_aciliyor_der", () => {
    render(<YuklemeEkrani durum={{ tur: "surum_yukleniyor", neden: "acma" }} indir={vi.fn()} />);
    expect(screen.getByRole("heading", { name: t("tarayici.acma_yukleniyor.baslik") })).toBeVisible();
    expect(screen.getByText(t("tarayici.acma_yukleniyor.bilgi"))).toBeVisible();
    expect(screen.queryByText(t("tarayici.surum_yukleniyor.bilgi"))).toBeNull();
  });
});
