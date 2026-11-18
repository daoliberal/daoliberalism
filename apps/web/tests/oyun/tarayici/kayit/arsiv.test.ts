// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ARSIV_AZAMI_YINELEME, ArsivHatasi, arsivliIstek, arsivUret, type ArsivliYanit } from "@/oyun/tarayici/kayit/arsiv";
import type { HaftaPaketi } from "@/oyun/tarayici/kayit/tel";
import { ANAHTAR, tarifOrnek, yeniDepo } from "./yardimci";

async function depoHazirla(haftalar: number[]) {
  const depo = await yeniDepo();
  await depo.kosuOlustur({ kosuId: "k", tarif: tarifOrnek(), modelAnahtari: ANAHTAR, ebeveyn: null, kaynak: "yerel", yayimlanan: 0, gunlukSira: 0, sonGoruntu: null, goruntuDurdu: null, sonDisaAktarim: 0, sonHatirlatma: 0 });
  await depo.haftalarYaz("k", haftalar.map((w) => ({ week: w })));
  return depo;
}

describe("arsiv_gerek koprusu", () => {
  it("depodan_arsiv_uretir_artan_hafta_eksikler_atlanir", async () => {
    const depo = await depoHazirla([1, 2, 3, 5]);
    expect((await arsivUret(depo, { runId: "k", from: 2, to: 5 })).map((p) => p.week)).toEqual([2, 3, 5]);
  });

  it("arsivsiz_yanit_yinelenmeden_doner", async () => {
    const depo = await depoHazirla([]);
    let n = 0;
    const y = await arsivliIstek(depo, async () => (n++, { status: 200, body: { a: 1 } }));
    expect(y.status).toBe(200);
    expect(n).toBe(1);
  });

  it("arsiv_gerek_gelince_depodan_verip_isteği_yineler", async () => {
    const depo = await depoHazirla([1, 2, 3, 4]);
    const verilen: (HaftaPaketi[] | undefined)[] = [];
    const y = await arsivliIstek(depo, async (arsiv) => {
      verilen.push(arsiv);
      return arsiv ? { status: 200, body: arsiv.length } : { status: 0, body: null, arsiv_gerek: { runId: "k", from: 1, to: 3 } };
    });
    expect(y).toEqual({ status: 200, body: 3 });
    expect(verilen.map((v) => v?.map((p) => p.week))).toEqual([undefined, [1, 2, 3]]);
  });

  it("yarista_ikinci_yineleme_yeni_aralik_istenir_ucuncu_yineleme_tamam", async () => {
    const depo = await depoHazirla([1, 2, 3, 4, 5, 6]);
    const araliklar = [
      { runId: "k", from: 1, to: 2 },
      { runId: "k", from: 1, to: 4 },
    ];
    let n = 0;
    const y = await arsivliIstek(depo, async () => (n < 2 ? { status: 0, body: null, arsiv_gerek: araliklar[n++] } : { status: 200, body: "tamam" }));
    expect(y.body).toBe("tamam");
    expect(n).toBe(2);
  });

  it("depoda_olmayan_aralik_arsiv_eksik_hatasi", async () => {
    const depo = await depoHazirla([1]);
    await expect(arsivliIstek(depo, async () => ({ status: 0, body: null, arsiv_gerek: { runId: "k", from: 7, to: 9 } }))).rejects.toMatchObject({ kod: "arsiv_eksik" });
  });

  it("en_cok_uc_yineleme_sonra_arsiv_dongusu", async () => {
    const depo = await depoHazirla([1, 2]);
    let n = 0;
    const sonsuz = async (): Promise<ArsivliYanit> => (n++, { status: 0, body: null, arsiv_gerek: { runId: "k", from: 1, to: 2 } });
    await expect(arsivliIstek(depo, sonsuz)).rejects.toBeInstanceOf(ArsivHatasi);
    expect(n).toBe(1 + ARSIV_AZAMI_YINELEME);
    expect(ARSIV_AZAMI_YINELEME).toBe(3);
  });
});
