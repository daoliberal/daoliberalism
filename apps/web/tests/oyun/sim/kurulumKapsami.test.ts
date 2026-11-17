import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { kurulumDegerleri, kurulumKartlari } from "@/oyun/sim/kurulumDegerleri";
import { parseRegistry } from "@/oyun/sim/live/wire";
import { tutarlilikUyarilari } from "@/oyun/screens/sart/ozelMantik";

/** Son inceleme I1: "yeni ölçüm" kapsamı tek kaynaktan (sunucu `plan.DECISIONS` → kayıt yayınındaki `new_measurement`) gelir; Sonuç süzgeci aynı alanı kullanır. */
const registry = parseRegistry(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../public/oyun-kayit/registry.json"), "utf-8")));
const isaretli = registry.cards.filter((c) => c.new_measurement === true).map((c) => c.id).sort();

describe("yeni ölçüm kapsamı", () => {
  it("sonuc_suzgeci_sunucunun_isaretledigi_kartlarin_tamamidir", () => {
    expect(kurulumKartlari(registry).map((c) => c.id).sort()).toEqual(isaretli);
  });

  it("d7_d9_d10_d11_kartlari_ve_d9_nun_active_hane_geliri_kartlari_kapsamda", () => {
    for (const id of ["nufus_olcegi", "npc_hanesi", "servet_kurali", "npc_en_az_nakit", "npc_havuz_vergisi", "kadro_hizi", "isci_akislari", "kamu_istihdami_havuz", "para_devresi", "hayalet_firma"]) {
      expect(isaretli, id).toContain(id);
    }
  });

  it("d6_ve_olcum_disi_kartlar_kapsamda_degil", () => {
    for (const id of ["gecis_destegi", "yeni_oyuncu_katilimi", "isten_cikarma_sirasi"]) expect(isaretli, id).not.toContain(id);
  });

  it("varsayilandan_farkli_active_hane_geliri_karti_listelenir", () => {
    const out = kurulumDegerleri(registry, { servet_kurali: false, npc_en_az_nakit: 0 });
    expect(out.map((o) => o.id)).toContain("servet_kurali");
  });

  it("alan_yoksa_kart_listelenmez", () => {
    const eski = { ...registry, cards: registry.cards.map((c) => ({ ...c, new_measurement: undefined })) };
    expect(kurulumKartlari(eski)).toEqual([]);
  });
});

describe("etkisiz kart birleşimleri için tutarlılık uyarısı (son inceleme M4)", () => {
  const ids = (taslak: Record<string, unknown>) => tutarlilikUyarilari(registry, taslak as never).map((u) => u.id);
  const destek = { hayalet_firma: { kip: "destek_gelmeyen", hafta: 13 } };

  it("destek_gelmeyen_haftalar_ama_gecis_destegi_kurtarma_fonuyla_degil", () => {
    expect(ids({ ...destek, gecis_destegi: "kapali" })).toContain("hayalet_destek_kapali");
    expect(ids({ ...destek, gecis_destegi: "kisa_sureli" })).toContain("hayalet_destek_kisa");
    expect(ids({ ...destek, gecis_destegi: "kurtarma_fonuyla" })).not.toContain("hayalet_destek_kapali");
    expect(ids({ hayalet_firma: { kip: "kapali", hafta: 13 }, gecis_destegi: "kapali" })).not.toContain("hayalet_destek_kapali");
  });

  it("bosluk_zinciri_acik_ama_ahirdan_gecis_kapali", () => {
    expect(ids({ bosluk_zinciri: true, ahir_gecisi: { kural: "kapali", prim: 20 } })).toContain("bosluk_zinciri_ahir_kapali");
    expect(ids({ bosluk_zinciri: true, ahir_gecisi: { kural: "otomatik", prim: 20 } })).not.toContain("bosluk_zinciri_ahir_kapali");
    expect(ids({ bosluk_zinciri: false, ahir_gecisi: { kural: "kapali", prim: 20 } })).not.toContain("bosluk_zinciri_ahir_kapali");
  });
});
