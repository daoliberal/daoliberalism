import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { IceAktarmaHatasi } from "@/oyun/tarayici/kayit/disaAktar";
import type { DepolamaDurumu, KayitHizmetleri, KosuOzeti } from "@/oyun/tarayici/hizmetler";
import { KayitPaneli } from "@/oyun/ui/KayitPaneli";

afterEach(cleanup);

const MB = 1024 * 1024;
const kosu = (ek: Partial<KosuOzeti> = {}): KosuOzeti => ({ kosuId: "canli-a1", ad: "Ilk oyun", hafta: 30, guncelleme: 1, kaynak: "yerel", tur: "kurucu", aktif: false, disaAktarilmayanHafta: 10, ...ek });
const depolama = (ek: Partial<DepolamaDurumu> = {}): DepolamaDurumu => ({ olcum: { kullanim: 50 * MB, kota: 1000 * MB, oran: 0.05 }, esik: 0.85, kotaUyarisi: false, kalicilik: { durum: "verildi", onceden: false, zaman: 1 }, ...ek });

function hizmetler(ek: Partial<KayitHizmetleri> = {}): KayitHizmetleri {
  return {
    dosyaSiniriMB: 64,
    depolama: vi.fn(async () => depolama()),
    kosular: vi.fn(async () => [kosu()]),
    disaAktar: vi.fn(async () => ({ ad: "d.json", metin: "{}" })),
    iceAktar: vi.fn(async () => ({ kosuId: "canli-yeni", hafta: 12, tur: "kurucu" as const })),
    sil: vi.fn(async () => undefined),
    ...ek,
  };
}

function ac(h: KayitHizmetleri, ek: Partial<Parameters<typeof KayitPaneli>[0]> = {}) {
  const props = { hizmetler: h, aktifKosuId: null, webkit: false, onKapat: vi.fn(), onAc: vi.fn(), indir: vi.fn(), ...ek };
  render(<KayitPaneli {...props} />);
  return props;
}

describe("KayitPaneli: depolama", () => {
  it("kullanim_kota_ve_persist_sonucunu_gosterir", async () => {
    ac(hizmetler());
    expect(await screen.findByText(t("kayit.depolama.kullanim", { kullanim: 50, kota: 1000, yuzde: 5 }))).toBeVisible();
    expect(screen.getByText(t("kayit.kalici.verildi"))).toBeVisible();
    expect(screen.queryByText(t("kayit.depolama.uyari", { yuzde: 90 }))).toBeNull();
  });

  it("kalici_depolama_verilmediyse_acik_uyari_kota_esigi_asilinca_kota_uyarisi", async () => {
    ac(hizmetler({ depolama: async () => depolama({ olcum: { kullanim: 900 * MB, kota: 1000 * MB, oran: 0.9 }, kotaUyarisi: true, kalicilik: { durum: "verilmedi", onceden: false, zaman: 1 } }) }));
    expect(await screen.findByText(t("kayit.kalici.verilmedi"))).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(t("kayit.depolama.uyari", { yuzde: 90 }));
  });

  it("olcum_yoksa_bilgi_ve_kalicilik_bilinmiyor_ve_Safari_7_gun_satiri_her_tarayicida_panelde", async () => {
    ac(hizmetler({ depolama: async () => depolama({ olcum: null, kalicilik: null }) }));
    expect(await screen.findByText(t("kayit.depolama.bilinmiyor"))).toBeVisible();
    expect(screen.getByText(t("kayit.kalici.bilinmiyor"))).toBeVisible();
    expect(screen.getByText(t("kayit.safari"))).toBeVisible();
  });

  it("acik_kod_satiri_ve_depo_baglantisi", async () => {
    ac(hizmetler());
    expect(await screen.findByText(t("acikkod.satir"))).toBeVisible();
    expect(screen.getByRole("link", { name: t("acikkod.baglanti") })).toHaveAttribute("href", "https://github.com/daoliberal/daoliberalism");
  });
});

describe("KayitPaneli: kayitli oyunlar", () => {
  it("liste_dis_aktarilmayan_hafta_bilgisini_gosterir_bos_listede_bilgi", async () => {
    ac(hizmetler());
    expect(await screen.findByText(t("kayit.kosu.satir", { ad: "Ilk oyun", hafta: 30 }))).toBeVisible();
    expect(screen.getByText(t("kayit.kosu.disa_gerek", { hafta: 10 }), { exact: false })).toBeVisible();
    cleanup();
    ac(hizmetler({ kosular: async () => [] }));
    expect(await screen.findByText(t("kayit.kosular.yok"))).toBeVisible();
  });

  it("disa_aktar_dosyayi_indirir_ve_bilgi_verir", async () => {
    const h = hizmetler();
    const p = ac(h);
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.disa_etiket", { ad: "Ilk oyun" }) }));
    await waitFor(() => expect(p.indir).toHaveBeenCalledWith("d.json", "{}"));
    expect(h.disaAktar).toHaveBeenCalledWith("canli-a1");
    expect(await screen.findByText(t("kayit.kosu.disa_tamam"))).toBeVisible();
  });

  it("ac_ve_oynat_kosu_kimligini_verir", async () => {
    const p = ac(hizmetler());
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "Ilk oyun" }) }));
    expect(p.onAc).toHaveBeenCalledWith("canli-a1", "kurucu");
  });

  it("silme_iki_adimli_onaylidir_ve_oynanan_oyun_silinemez", async () => {
    const h = hizmetler({ kosular: vi.fn().mockResolvedValueOnce([kosu()]).mockResolvedValue([]) });
    ac(h);
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.sil_etiket", { ad: "Ilk oyun" }) }));
    expect(h.sil).not.toHaveBeenCalled();
    expect(screen.getByText(t("kayit.kosu.sil_onay", { ad: "Ilk oyun" }))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("kayit.kosu.sil_evet") }));
    await waitFor(() => expect(h.sil).toHaveBeenCalledWith("canli-a1"));
    expect(await screen.findByText(t("kayit.kosular.yok"))).toBeVisible();
    cleanup();
    ac(hizmetler(), { aktifKosuId: "canli-a1" });
    expect(await screen.findByText(t("kayit.kosu.aktif"), { exact: false })).toBeVisible();
    expect(screen.getByRole("button", { name: t("kayit.kosu.sil_etiket", { ad: "Ilk oyun" }) })).toBeDisabled();       // Y1: devre disi + aciklama
    expect(screen.getByText(t("kayit.kosu.sil_aktif"))).toBeVisible();
    expect(screen.queryByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "Ilk oyun" }) })).toBeNull();
  });
});

describe("KayitPaneli: Y1 koprunun takip ettigi ve DAO koşular", () => {
  it("kopru_takip_ediyorsa_rota_baska_olsa_da_silinemez_Ac_gosterilmez", async () => {
    ac(hizmetler({ kosular: async () => [kosu({ aktif: true })] }));
    expect(await screen.findByRole("button", { name: t("kayit.kosu.sil_etiket", { ad: "Ilk oyun" }) })).toBeDisabled();
    expect(screen.queryByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "Ilk oyun" }) })).toBeNull();
  });

  it("DAO_kosusu_icin_Ac_ve_oynat_tur_dao_ile_cagrilir", async () => {
    const p = ac(hizmetler({ kosular: async () => [kosu({ tur: "dao", kosuId: "canli-dao1" })] }));
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.ac_etiket", { ad: "Ilk oyun" }) }));
    expect(p.onAc).toHaveBeenCalledWith("canli-dao1", "dao");
  });

  it("sil_onayinda_odak_Vazgec_dugmesine_gider", async () => {
    ac(hizmetler());
    await userEvent.click(await screen.findByRole("button", { name: t("kayit.kosu.sil_etiket", { ad: "Ilk oyun" }) }));
    expect(screen.getByRole("button", { name: t("kayit.kosu.vazgec") })).toHaveFocus();
  });
});

describe("KayitPaneli: ice aktarma", () => {
  const dosya = (): File => new File(["{}"], "k.json", { type: "application/json" });

  it("dosya_secilince_hizmete_verilir_basari_mesaji_ve_ac_dugmesi", async () => {
    const h = hizmetler();
    const p = ac(h);
    const alan = await screen.findByLabelText(t("kayit.ice.dosya"));
    await userEvent.upload(alan, dosya());
    await userEvent.click(screen.getByRole("button", { name: t("kayit.ice.dugme") }));
    expect(await screen.findByText(t("kayit.ice.tamam", { hafta: 12 }))).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("kayit.ice.ac") }));
    expect(p.onAc).toHaveBeenCalledWith("canli-yeni", "kurucu");
  });

  it("hizmet_hatasi_kodlarina_gore_anlasilir_metin_cok_buyukte_sinir_MB_ile", async () => {
    const h = hizmetler({ iceAktar: vi.fn().mockRejectedValueOnce(new IceAktarmaHatasi("goruntu_iceriyor")).mockRejectedValueOnce(new IceAktarmaHatasi("cok_buyuk")).mockRejectedValueOnce(new Error("beklenmedik")) });
    ac(h);
    const alan = await screen.findByLabelText(t("kayit.ice.dosya"));
    const dugme = screen.getByRole("button", { name: t("kayit.ice.dugme") });
    await userEvent.upload(alan, dosya());
    await userEvent.click(dugme);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("kayit.ice.hata.goruntu_iceriyor"));
    await userEvent.click(dugme);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(t("kayit.ice.hata.cok_buyuk", { sinir: 64 })));
    await userEvent.click(dugme);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(t("kayit.ice.hata.genel")));
  });

  it("dosya_secilmeden_dugme_pasif", async () => {
    ac(hizmetler());
    expect(await screen.findByRole("button", { name: t("kayit.ice.dugme") })).toBeDisabled();
  });
});

describe("KayitPaneli: kapatma ve Safari", () => {
  it("kapat_dugmesi_onKapat_cagirir", async () => {
    const p = ac(hizmetler());
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("button", { name: t("kayit.kapat") }));
    expect(p.onKapat).toHaveBeenCalled();
  });
});
