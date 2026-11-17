import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import { sartTabani } from "@/oyun/screens/sart/sartMantik";
import { krediBolumleri, tutarlilikUyarilari } from "@/oyun/screens/sart/ozelMantik";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { ConsistencyRule, Job, JobMember, PreviewSpec, Registry, SimSource, SourceInfo, ValuesPatch } from "@/oyun/sim/types";
import { contractRegistry } from "../helpers/registryFixtures";

afterEach(() => cleanup());

/** Kayıttaki bütün kartlar canlı (`apply: "live"`): kilit nedeni bu testlerin konusu değil; kart sayısına bağlı değiliz. */
const canliKayit = (rules: ConsistencyRule[] | undefined = undefined): Registry => {
  const reg = contractRegistry();
  reg.cards = reg.cards.map((c) => ({ ...c, apply: "live" as const }));
  if (rules) reg.consistency = rules;
  return reg;
};

type Over = { registry?: Registry; init?: ValuesPatch; onDraft?: (d: ValuesPatch) => void; onizleme?: boolean; source?: SimSource; baglam?: { seedIndex?: number; templateId?: string; durationWeeks?: number; baseValues?: ValuesPatch } };

function Host({ registry = canliKayit(), init = {}, onDraft, onizleme, source, baglam = {} }: Over) {
  const base = sartTabani(registry, {});
  const [patch, setPatch] = useState<ValuesPatch>(init);
  const editor = (
    <SartEditoru
      mode="builder" registry={registry} base={base} draft={{ ...base, ...patch }} context={{ durationWeeks: 200 }}
      {...(onizleme ? { onizleme: { config: { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: baglam.templateId ?? "dayanikli_taban", durationWeeks: baglam.durationWeeks ?? 200, seedIndex: baglam.seedIndex ?? 0 }, baseValues: baglam.baseValues ?? {} } } : {})}
      onDraft={(next) => {
        setPatch(next);
        onDraft?.(next);
      }}
    />
  );
  return source ? <SimSourceProvider source={source}>{editor}</SimSourceProvider> : editor;
}

const grupDugmesi = (title: string) => within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: new RegExp(title) });
const kart = (title: string) => screen.getByRole("article", { name: title });
const uzmanAc = () => {
  const b = screen.queryByRole("button", { name: /^Göster \(\d+\)$/ });
  if (b) fireEvent.click(b);
};
const kredi = () => {
  render(<Host onDraft={(d) => (son.d = d)} />);
  fireEvent.click(grupDugmesi("Kredi"));
  uzmanAc();
};
const son: { d: ValuesPatch | null } = { d: null };

describe("kredi türleri ve menüsü", () => {
  it("credit_types_are_grouped_a_to_d_and_every_kredi_card_appears_once", () => {
    const reg = canliKayit();
    const b = krediBolumleri(reg.cards.filter((c) => c.group === "kredi"));
    const hepsi = [b.ortak, b.varyant, ...b.gruplar.flatMap((g) => g.cards), ...b.diger].filter((c) => c !== undefined).map((c) => c!.id);
    expect(new Set(hepsi).size).toBe(hepsi.length);
    expect(hepsi.sort()).toEqual(reg.cards.filter((c) => c.group === "kredi").map((c) => c.id).sort());
    expect(b.gruplar.map((g) => g.id)).toEqual(["A", "B", "C", "D"]);
    kredi();
    for (const g of ["A", "B", "C", "D"] as const) expect(screen.getByText(tr[`sart.kredi.grup.${g}`])).toBeInTheDocument();
    expect(kart("Ortak kredi kuralları")).toBeInTheDocument();
    expect(kart("Genç firma kredisi")).toBeInTheDocument();
  });

  it("credit_type_toggle_sends_fields_object", () => {
    kredi();
    const genc = within(kart("Genç firma kredisi"));
    fireEvent.click(genc.getAllByRole("button", { name: "kapalı" })[0]!);
    const yazilan = son.d!.kredi_genc as Record<string, unknown>;
    // tek alan değişse de alanların TAMAMI nesne olarak iletilir
    expect(Object.keys(yazilan).sort()).toEqual(["acik", "faiz_carpani", "havuz_payi", "limit", "odemesiz", "sure"]);
    expect(yazilan.acik).toBe(false);
    expect(yazilan.sure).toBe(52);
  });

  it("credit_menu_reset_and_copy_variant_passive", () => {
    kredi();
    const genc = () => within(kart("Genç firma kredisi"));
    // menü kartın üstündeki eylem satırındadır (kartın adını düğme adında taşır)
    const menu = () => screen.getByRole("button", { name: t("sart.kredi.eylemler_ad", { ad: "Genç firma kredisi" }) });
    fireEvent.click(genc().getAllByRole("button", { name: "kapalı" })[0]!);
    expect((son.d!.kredi_genc as Record<string, unknown>).acik).toBe(false);
    // menü: Varsayılana döndür
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("button", { name: t("sart.kredi.varsayilana") }));
    expect(son.d!.kredi_genc).toEqual({ acik: true, faiz_carpani: 0.7, havuz_payi: 50, limit: 1.5, odemesiz: 13, sure: 52 });
    // menü: Kendi varyantına kopyala -> taslak, modelde yok, koşuya gitmez
    const onceki = JSON.stringify(son.d);
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("button", { name: t("sart.kredi.kopyala") }));
    const varyant = within(screen.getByLabelText(t("sart.kredi.varyant_ad")).closest("div[class*='varyant']") as HTMLElement);
    expect(varyant.getByText(t("sart.kredi.varyant_modelde_yok"))).toBeInTheDocument();
    expect(varyant.getByText(t("sart.kredi.varyant_taslak"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("sart.kredi.varyant_ad"))).toHaveValue("Genç firma kredisi (kopya)");
    expect(screen.getByText(t("sart.kredi.varyant_eklendi", { ad: "Genç firma kredisi (kopya)" }))).toBeInTheDocument();
    expect(JSON.stringify(son.d)).toBe(onceki); // taslağa hiçbir şey yazılmadı
    expect(screen.getByText(t("sart.kredi.varyant_kaynak", { tur: "Genç firma kredisi" }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("sart.kredi.varyant_sil") }));
    expect(screen.queryByLabelText(t("sart.kredi.varyant_ad"))).toBeNull();
  });

  it("menu_closes_with_escape_and_returns_focus", () => {
    kredi();
    const dugme = screen.getByRole("button", { name: t("sart.kredi.eylemler_ad", { ad: "Genç firma kredisi" }) });
    fireEvent.click(dugme);
    expect(dugme).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByRole("button", { name: t("sart.kredi.kopyala") }), { key: "Escape" });
    expect(dugme).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(dugme);
  });

  it("locked_credit_card_cannot_be_reset_by_menu", () => {
    const reg = canliKayit();
    reg.cards = reg.cards.map((c) => (c.id === "kredi_genc" ? { ...c, apply: "unknown" as const } : c));
    render(<Host registry={reg} />);
    fireEvent.click(grupDugmesi("Kredi"));
    fireEvent.click(screen.getByRole("button", { name: t("sart.kredi.eylemler_ad", { ad: "Genç firma kredisi" }) }));
    expect(screen.getByRole("button", { name: t("sart.kredi.varsayilana") })).toBeDisabled();
  });
});

describe("kuruluş fonu uyarısı", () => {
  const fonKapali: ValuesPatch = { kurulus_fonu: { acik: false, hedef: 50 } };

  it("no_warning_when_the_fund_is_open", () => {
    render(<Host />);
    fireEvent.click(grupDugmesi("Kredi"));
    expect(screen.queryByText(t("sart.fon.uyari"))).toBeNull();
  });

  it("fund_warning_links_to_fund_card", () => {
    render(<Host init={fonKapali} />);
    fireEvent.click(grupDugmesi("Kredi"));
    expect(screen.getByText(t("sart.fon.uyari"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("sart.fon.git") }));
    // fon kartı Şehir bütçesi grubunda (uzman): grup değişir, uzman açılır, karta odak gelir
    const baslik = screen.getByRole("heading", { name: "Kuruluş fonu", level: 4 });
    expect(document.activeElement).toBe(baslik);
    expect(grupDugmesi("Şehir bütçesi")).toHaveAttribute("aria-current", "page");
  });
});

describe("bütçe: gider kalemleri üyelik listesi", () => {
  const kalemler = () => within(kart("Basım izninden tam pay alan giderler"));

  it("shows_two_groups_not_an_order_and_the_no_print_note", () => {
    render(<Host />);
    fireEvent.click(grupDugmesi("Şehir bütçesi"));
    const k = kalemler();
    expect(k.getByText(t("sart.butce.sira_yok"))).toBeInTheDocument();
    expect(k.getByText(t("sart.butce.hic"))).toBeInTheDocument();
    for (const kalem of ["kamu hizmet sözleşmesi", "altyapı hizmet sözleşmesi", "kamu firmalarının kuruluş sermayesi", "geçiş desteği"]) expect(tr["sart.butce.hic"]).toContain(kalem);
    expect(k.queryByRole("button", { name: /Yukarı|Aşağı/ })).toBeNull(); // sıra değil üyelik
    expect(k.getByRole("button", { name: t("sart.butce.tama_al", { ad: "Belediye ücretleri" }) })).toBeInTheDocument();
    expect(k.getByRole("button", { name: t("sart.butce.yarima_indir", { ad: "İşsizlik ödeneği" }) })).toBeInTheDocument();
  });

  it("budget_order_change_in_diff", () => {
    const fark: ValuesPatch[] = [];
    render(<Host onDraft={(d) => fark.push(d)} />);
    fireEvent.click(grupDugmesi("Şehir bütçesi"));
    fireEvent.click(kalemler().getByRole("button", { name: t("sart.butce.tama_al", { ad: "Belediye ücretleri" }) }));
    expect(fark.at(-1)!.gider_onceligi).toEqual(["issizlik_odenegi", "ciraklik_bursu", "belediye_ucreti"]);
    expect(screen.getByRole("button", { name: /Basım izninden tam pay alan giderler: .*→.*Belediye ücretleri/ })).toBeInTheDocument();
    // çıkarma da bir değişikliktir; boş liste (multi) geçerlidir
    fireEvent.click(kalemler().getByRole("button", { name: t("sart.butce.yarima_indir", { ad: "İşsizlik ödeneği" }) }));
    fireEvent.click(kalemler().getByRole("button", { name: t("sart.butce.yarima_indir", { ad: "Çıraklık ocağı ücretleri" }) }));
    fireEvent.click(kalemler().getByRole("button", { name: t("sart.butce.yarima_indir", { ad: "Belediye ücretleri" }) }));
    expect(fark.at(-1)!.gider_onceligi).toEqual([]);
  });

  it("order_kind_never_empties_the_list_and_keeps_existing_order", () => {
    const reg = canliKayit();
    reg.cards = reg.cards.map((c) => (c.id === "gider_onceligi" && c.control.type === "multi" ? { ...c, kind: "order" as const, control: { ...c.control, type: "order" as const }, default: ["ciraklik_bursu", "issizlik_odenegi"] } : c));
    const fark: ValuesPatch[] = [];
    render(<Host registry={reg} onDraft={(d) => fark.push(d)} />);
    fireEvent.click(grupDugmesi("Şehir bütçesi"));
    fireEvent.click(kalemler().getByRole("button", { name: t("sart.butce.tama_al", { ad: "Belediye ücretleri" }) }));
    expect(fark.at(-1)!.gider_onceligi).toEqual(["ciraklik_bursu", "issizlik_odenegi", "belediye_ucreti"]); // sıra korunur, yeni kalem sona
    fireEvent.click(kalemler().getByRole("button", { name: t("sart.butce.yarima_indir", { ad: "Belediye ücretleri" }) }));
    fireEvent.click(kalemler().getByRole("button", { name: t("sart.butce.yarima_indir", { ad: "İşsizlik ödeneği" }) }));
    expect(kalemler().getByRole("button", { name: t("sart.butce.yarima_indir", { ad: "Çıraklık ocağı ücretleri" }) })).toBeDisabled();
    expect(kalemler().getByText(t("sart.butce.son_kalem"))).toBeInTheDocument();
  });
});

describe("sabit kalemler", () => {
  it("fixed_items_are_read_only_with_shown_rows", () => {
    render(<Host />);
    fireEvent.click(grupDugmesi("sabit kalemleri"));
    const k = within(kart("Dünyanın sabit kalemleri"));
    expect(k.queryByRole("textbox")).toBeNull();
    expect(k.queryByRole("button")).toBeNull();
    expect(k.getByText("400 Akçe")).toBeInTheDocument();
    expect(screen.getByText(t("sart.sabit.not"))).toBeInTheDocument();
  });
});

describe("faiz hesaplayıcı", () => {
  const faizGrubu = () => {
    render(<Host />);
    return within(screen.getByRole("region", { name: t("sart.faiz.baslik") }));
  };

  it("labelled_not_affecting_simulation_and_shows_target_for_default_inputs", () => {
    const f = faizGrubu();
    expect(f.getByText(t("sart.faiz.etiket"))).toBeInTheDocument();
    // varsayılan girdiler hedefte: işsizlik normal (25), kredi/mevduat hedefte; hedef faiz tarafsız faiz (%0,3/hafta)
    expect(f.getByRole("status")).toHaveTextContent("hedef faiz %0,3/hafta");
    expect(f.getByText(t("sart.faiz.formul.cd"))).toBeInTheDocument();
    expect(document.querySelector("svg path[data-seri='faiz']")?.getAttribute("d")).toMatch(/^M/);
  });

  it("faiz_step_line_shown", () => {
    const f = faizGrubu();
    expect(f.getByText(t("sart.faiz.adim", { n: "0,03" }))).toBeInTheDocument();
  });

  it("changing_trial_input_changes_the_target", () => {
    const f = faizGrubu();
    fireEvent.change(f.getByLabelText(t("sart.faiz.girdi.infl")), { target: { value: "5" } });
    // 0,003 + 0,01 × 0,05 = 0,0035 -> %0,35/hafta
    expect(f.getByRole("status")).toHaveTextContent("hedef faiz %0,35/hafta");
    fireEvent.change(f.getByLabelText(t("sart.faiz.girdi.infl")), { target: { value: "20" } });
    fireEvent.change(f.getByLabelText(t("sart.faiz.girdi.unemp")), { target: { value: "0" } });
    fireEvent.change(f.getByLabelText(t("sart.faiz.girdi.cd")), { target: { value: "0" } });
    // 0,003 + 0,01 × 0,2 + 0,004 × 0,25 + 0,006 × 0,7 = 0,0102 -> tavan %1
    expect(f.getByRole("status")).toHaveTextContent("hedef faiz %1/hafta");
    expect(f.getByText(t("sart.faiz.kirpildi_tavan"))).toBeInTheDocument();
  });

  it("idle_branch_swaps_the_fourth_input_when_credit_target_is_off", () => {
    render(<Host init={{ kredi_canliligi_hedefi: { acik: false, hedef: 0.7, tepki: "orta" } }} />);
    const f = within(screen.getByRole("region", { name: t("sart.faiz.baslik") }));
    expect(f.getByLabelText(t("sart.faiz.girdi.idle"))).toBeInTheDocument();
    expect(f.queryByLabelText(t("sart.faiz.girdi.cd"))).toBeNull();
    expect(f.getByText(t("sart.faiz.formul.bosta"))).toBeInTheDocument();
  });

  it("faiz_rule_off_shows_neutral_text", () => {
    render(<Host init={{ faiz_kurali: "piyasa" }} />);
    const f = within(screen.getByRole("region", { name: t("sart.faiz.baslik") }));
    expect(f.getByText(t("sart.faiz.kapali"))).toBeInTheDocument();
    expect(f.queryByRole("status")).toBeNull();
    expect(document.querySelector("svg path[data-seri='faiz']")).toBeNull();
  });

  it("missing_cards_show_a_plain_note", () => {
    const reg = canliKayit();
    reg.cards = reg.cards.filter((c) => c.id !== "tarafsiz_faiz");
    render(<Host registry={reg} />);
    expect(screen.getByText(t("sart.faiz.eksik"))).toBeInTheDocument();
  });
});

describe("tutarlılık uyarıları", () => {
  const kurallar: ConsistencyRule[] = [
    { id: "kurtarma_gecis", text: "Kurtarma varken geçiş desteği çalışmaz.", when: { zarar_eden_firmayi_kurtarma: "var", gecis_destegi: "kisa_sureli" } },
    { id: "fon_genc", text: "Fon kapalıyken program eksik çalışır.", when: { kurulus_fonu: { acik: false } } },
    { id: "aralik", text: "Taban tavandan büyük olamaz.", artan: { kart: "tarafsiz_faiz", alanlar: ["taban", "tavan"] } },
  ];

  it("no_registry_rules_renders_no_section", () => {
    const reg = canliKayit();
    delete reg.consistency; // kayıt kural yayımlamıyorsa bölüm çizilmez
    render(<Host registry={reg} />);
    expect(screen.queryByRole("region", { name: t("sart.tutarlilik.baslik") })).toBeNull();
  });

  it("clean_draft_says_no_conflict", () => {
    render(<Host registry={canliKayit(kurallar)} />);
    const r = within(screen.getByRole("region", { name: t("sart.tutarlilik.baslik") }));
    expect(r.getByText(t("sart.tutarlilik.yok"))).toBeInTheDocument();
  });

  it("consistency_warning_appears_and_links_card", () => {
    render(<Host registry={canliKayit(kurallar)} init={{ kurulus_fonu: { acik: false, hedef: 50 } }} />);
    const r = within(screen.getByRole("region", { name: t("sart.tutarlilik.baslik") }));
    expect(r.getByText("Fon kapalıyken program eksik çalışır.")).toBeInTheDocument();
    expect(r.getByText(t("sart.tutarlilik.sayi", { n: 1 }))).toBeInTheDocument();
    fireEvent.click(r.getByRole("button", { name: t("sart.tutarlilik.git_dugme", { ad: "Kuruluş fonu" }) }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Kuruluş fonu", level: 4 }));
  });

  it("when_needs_every_card_to_match_and_artan_checks_field_order", () => {
    const reg = canliKayit(kurallar);
    const taban = sartTabani(reg, {});
    const ates = (d: ValuesPatch) => tutarlilikUyarilari(reg, { ...taban, ...d }).map((u) => u.id);
    expect(ates({})).toEqual([]);
    expect(ates({ zarar_eden_firmayi_kurtarma: "var" })).toEqual([]); // iki kart birlikte eşleşmeli
    expect(ates({ zarar_eden_firmayi_kurtarma: "var", gecis_destegi: "kisa_sureli" })).toEqual(["kurtarma_gecis"]);
    expect(ates({ tarafsiz_faiz: { tarafsiz: 0.3, taban: 0.5, tavan: 0.2, adim: 0.03 } })).toEqual(["aralik"]);
    expect(ates({ tarafsiz_faiz: { tarafsiz: 0.3, taban: 0.2, tavan: 0.2, adim: 0.03 } })).toEqual([]); // eşit olabilir
  });

  it("locked_cards_still_count_with_their_effective_value_and_unknown_cards_never_fire", () => {
    const reg = canliKayit(kurallar);
    reg.cards = reg.cards.map((c) => (c.id === "kurulus_fonu" ? { ...c, apply: "unknown" as const } : c));
    const taban = sartTabani(reg, {});
    // kilitli kartın değeri (şablondan) sunucuda geçerlidir: uyarı susmaz
    expect(tutarlilikUyarilari(reg, { ...taban, kurulus_fonu: { acik: false, hedef: 50 } }).map((u) => u.id)).toEqual(["fon_genc"]);
    expect(tutarlilikUyarilari({ ...reg, consistency: [{ id: "x", text: "x", when: { yok_boyle_kart: true } }] }, taban)).toEqual([]);
  });

  it("every_registry_rule_can_fire_and_defaults_are_quiet", async () => {
    // Gerçek tutarlılık dosyası (R1b): varsayılanda gürültü yok; her `when` kuralı kendi koşuluyla ateşlenir (kart sayısına bağlı değil).
    const { readFileSync, existsSync } = await import("node:fs");
    const path = await import("node:path");
    const f = path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/registry/tutarlilik.json");
    expect(existsSync(f), f).toBe(true);
    const doc = JSON.parse(readFileSync(f, "utf-8")) as { rules: { id: string; when?: Record<string, never>; artan?: { kart: string; alanlar: string[] } }[] };
    const reg = canliKayit(doc.rules.map((r) => ({ ...r, text: r.id })));
    const taban = sartTabani(reg, {});
    expect(tutarlilikUyarilari(reg, taban)).toEqual([]);
    for (const r of doc.rules) {
      if (r.when) {
        const d: ValuesPatch = {};
        for (const [id, b] of Object.entries(r.when)) {
          const cur = taban[id];
          d[id] = typeof b === "object" && b !== null && !Array.isArray(b) ? { ...(cur as object), ...(b as object) } as ValuesPatch[string] : (b as ValuesPatch[string]);
        }
        expect(tutarlilikUyarilari(reg, { ...taban, ...d }).map((u) => u.id), r.id).toContain(r.id);
      } else if (r.artan) {
        const cur = { ...(taban[r.artan.kart] as Record<string, number>) };
        r.artan.alanlar.forEach((k, i) => {
          cur[k] = 1 - i * 0.1; // azalan: kural ihlali
        });
        expect(tutarlilikUyarilari(reg, { ...taban, [r.artan.kart]: cur }).map((u) => u.id), r.id).toContain(r.id);
      }
    }
  });
});

describe("canlı özet", () => {
  it("canli_ozet_no_prediction_text", () => {
    render(<Host init={{ ucret_stopaji: 12.5 }} />);
    const o = within(screen.getByRole("region", { name: t("sart.ozet.baslik") }));
    expect(o.getByText("Ücret stopajı: %10 → %12,5")).toBeInTheDocument();
    expect(o.getByText(t("sart.ozet.olculmedi"))).toBeInTheDocument();
    expect(o.getByText(t("sart.ozet.tahmin_yok"))).toBeInTheDocument();
    // prototipteki uydurma tahmin satırı taşınmadı
    expect(screen.queryByText(/Tahmin \(prototip kuralı/)).toBeNull();
    expect(Object.values(tr).some((v) => /Tahmin \(prototip kuralı/.test(v))).toBe(false);
  });

  it("measured_value_is_marked_olculdu", () => {
    const reg = canliKayit();
    const kart0 = reg.cards.find((c) => c.id === "ucret_stopaji")!;
    reg.cards = reg.cards.map((c) => (c.id === "ucret_stopaji" ? { ...c, measured_values: [15], measured_weeks: 200, measured_with: null, hint: "ölçüm", hint_source: "x" } : c));
    expect(kart0).toBeTruthy();
    render(<Host registry={reg} init={{ ucret_stopaji: 15 }} />);
    expect(within(screen.getByRole("region", { name: t("sart.ozet.baslik") })).getByText(t("sart.ozet.olculdu"))).toBeInTheDocument();
  });

  it("no_changes_message_and_preview_disabled_without_context_or_changes", () => {
    render(<Host />);
    const o = within(screen.getByRole("region", { name: t("sart.ozet.baslik") }));
    expect(o.getByText(t("sart.ozet.degisen_yok"))).toBeInTheDocument();
    expect(o.getByRole("button", { name: t("sart.ozet.onizleme_baslat") })).toBeDisabled();
    expect(o.getByText(t("sart.ozet.onizleme_yok_baglam"))).toBeInTheDocument();
  });
});

describe("etki önizlemesi (S3 preview işi)", () => {
  // Sahte zamanlayıcı: yoklama aralığı (1 sn) testte `advanceTimersByTimeAsync` ile ilerletilir; gerçek zamana ve sıkı döngüye bağlı değil.
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const uye = (label: string, served: number, hata?: string): JobMember => ({
    label, status: hata ? "failed" : "done", seedIndex: 0, weeks: 52,
    series: { served: [0.5, served], failed_cum: [0, 3], city_cash_total: [1000, 2000], gini: [0.4, 0.45], unemployment_rate: [0.2, 0.1], failed_total_cum: [0, 11], unemployment_rate_all: [0.7, 0.6] },
    ...(hata ? { error: hata } : {}),
  });
  const is = (status: Job["status"], members: JobMember[], done = 52): Job => ({ jobId: "job-1", kind: "preview", status, progress: { done, total: 104 }, members });
  const ikili = (a = 0.6, b = 0.7): JobMember[] => [uye("base", a), uye("draft", b)];

  /** `jobs`: her yoklamada sıradaki yanıt (sonuncusu tekrarlanır). `start`: istenirse elle çözülen başlatma sözü. */
  function kaynak(over: { caps?: boolean; kind?: "live" | "replay"; jobs?: Job[]; start?: () => Promise<string> } = {}) {
    const jobs = [...(over.jobs ?? [])];
    const startJob = vi.fn<(s: PreviewSpec) => Promise<string>>(over.start ?? (async () => "job-1"));
    const job = vi.fn(async () => (jobs.length > 1 ? jobs.shift()! : jobs[0]!));
    const cancelJob = vi.fn<(id: string) => Promise<Job>>(async () => is("cancelled", []));
    const info: SourceInfo = {
      kind: over.kind ?? "live", modelNote: "", seeds: [], durationWeeks: 200, settings: [], fixedRules: [], templates: [],
      capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false, jobs: over.caps ?? true },
    };
    const source = { kind: over.kind ?? "live", capabilities: info.capabilities, info: async () => info, startJob, job, cancelJob } as unknown as SimSource;
    return { source, startJob, job, cancelJob };
  }
  const ozet = () => within(screen.getByRole("region", { name: t("sart.ozet.baslik") }));
  const baslat = () => ozet().getByRole("button", { name: t("sart.ozet.onizleme_baslat") });
  // Önce bekleyen vaatler (başlatma yanıtı, yeniden çizim) boşalır, sonra yoklama aralığı ilerler.
  const yokla = async (ms = 1000) => act(async () => { for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(ms); });
  /** Koşul sağlanana dek bir sonraki zamanlayıcıya ilerler (sahte saat; en çok 12 adım). */
  const sonucaKadar = async (kosul: () => boolean) => {
    for (let i = 0; i < 12 && !kosul(); i++) await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
  };
  const hazir = async () => waitFor(() => expect(baslat()).toBeEnabled());
  const stopaj = (v: string) => {
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: v } });
  };

  it("runs_a_52_week_preview_with_base_and_draft_and_shows_both_results", async () => {
    const k = kaynak({ jobs: [is("running", ikili(), 10), is("done", ikili(), 104)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    const spec = k.startJob.mock.calls[0]![0];
    expect([spec.kind, spec.weeks, spec.base.values, spec.draft.values, spec.base.templateId === spec.draft.templateId]).toEqual(["preview", 52, {}, { ucret_stopaji: 12.5 }, true]);
    await yokla();
    expect(ozet().getByText(t("sart.ozet.onizleme_ilerleme", { done: 10, total: 104 }))).toBeInTheDocument();
    await yokla();
    const tablo = ozet().getByRole("table", { name: t("sart.ozet.tablo") });
    expect(within(tablo).getByText("%60")).toBeInTheDocument();
    expect(within(tablo).getByText("%70")).toBeInTheDocument();
    expect(within(tablo).getAllByText("11").length).toBeGreaterThan(0);                     // toplam batan (failed_total_cum), yerleşik iflas (3) değil
    expect(within(tablo).queryByText("3")).toBeNull();
    expect(within(tablo).getAllByText("%60,0").length).toBeGreaterThan(0);                  // geniş işsizlik (unemployment_rate_all), oyuncu oranı (%10) değil
    expect(ozet().getByText(t("sart.ozet.onizleme_bitti", { n: 52 }))).toBeInTheDocument();
  });

  it("preview_two_series_labelled_52_weeks", async () => {
    const k = kaynak({ jobs: [is("done", ikili(0.6, 0.7), 104)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await yokla();
    await yokla();
    // İki gerçek koşu iki çizgi olur ve grafik "52 haftalık önizleme" diye adlanır.
    const sekil = ozet().getByRole("figure");
    expect(within(sekil).getByText(t("sart.onizleme.grafik", { n: 52 }))).toBeInTheDocument();
    expect(sekil.querySelectorAll("[data-seri]")).toHaveLength(2);
    expect([...sekil.querySelectorAll("[data-seri]")].map((p) => p.getAttribute("data-seri"))).toEqual(["base", "draft"]);
    expect(within(sekil).getByText(new RegExp(t("sart.ozet.uye.base")))).toBeInTheDocument();
    expect(within(sekil).getByText(new RegExp(t("sart.ozet.uye.draft")))).toBeInTheDocument();
  });

  it("cancel_calls_the_server_and_says_so", async () => {
    const k = kaynak({ jobs: [is("running", ikili(), 10)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    fireEvent.click(await ozet().findByRole("button", { name: t("sart.ozet.onizleme_iptal") }));
    await waitFor(() => expect(k.cancelJob).toHaveBeenCalledWith("job-1"));
    expect(await ozet().findByText(t("sart.ozet.onizleme_iptal_edildi"))).toBeInTheDocument();
    await yokla(3000); // iptalden sonra yoklama sürmez
    expect(k.job).not.toHaveBeenCalled();
    expect(baslat()).toBeEnabled();
  });

  it("failed_member_shows_reason_in_player_language", async () => {
    const k = kaynak({ jobs: [is("done", [uye("base", 0.6), uye("draft", 0.7, "model_error")], 104)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await yokla();
    expect(ozet().getByText(t("sart.ozet.uye_hata", { ad: t("sart.ozet.uye.draft"), neden: t("sart.ozet.hata.model_error") }))).toBeInTheDocument();
    expect(ozet().queryByRole("table")).toBeNull();
  });

  it("unknown_error_code_is_not_shown_raw", async () => {
    const k = kaynak({ jobs: [is("done", [uye("base", 0.6, "garip_kod_xyz"), uye("draft", 0.7)], 104)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await yokla();
    expect(ozet().getByText(t("sart.ozet.uye_hata", { ad: t("sart.ozet.uye.base"), neden: t("sart.ozet.hata.diger") }))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("garip_kod_xyz");
  });

  it("job_level_failure_without_failed_members_still_shows_a_banner", async () => {
    const k = kaynak({ jobs: [is("failed", ikili(), 20)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await yokla();
    expect(ozet().getByText(t("sart.ozet.onizleme_is_hata"))).toBeInTheDocument();
    expect(ozet().queryByRole("table")).toBeNull();
  });

  it("busy_server_is_explained", async () => {
    const k = kaynak({ start: async () => { throw new SimUnsupported("job_running"); } });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    expect(await ozet().findByText(t("sart.ozet.onizleme_mesgul"))).toBeInTheDocument();
  });

  it("disabled_with_reason_on_replay_without_capability_and_without_changes", async () => {
    const replay = kaynak({ kind: "replay", caps: false });
    const a = render(<Host source={replay.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    expect(await ozet().findByText(t("sart.ozet.onizleme_yok_kayit"))).toBeInTheDocument();
    expect(baslat()).toBeDisabled();
    a.unmount();
    const eski = kaynak({ caps: false });
    const b = render(<Host source={eski.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    expect(await ozet().findByText(t("sart.ozet.onizleme_yok_yetenek"))).toBeInTheDocument();
    b.unmount();
    const bos = kaynak();
    render(<Host source={bos.source} onizleme />);
    expect(await ozet().findByText(t("sart.ozet.onizleme_yok_degisiklik"))).toBeInTheDocument();
    expect(bos.startJob).not.toHaveBeenCalled();
  });

  it("leaving_the_editor_cancels_a_running_job", async () => {
    const k = kaynak({ jobs: [is("running", ikili(), 10)] });
    const r = render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await yokla();
    await ozet().findByText(t("sart.ozet.onizleme_ilerleme", { done: 10, total: 104 }));
    await act(async () => r.unmount());
    expect(k.cancelJob).toHaveBeenCalledWith("job-1");
  });

  it("leaving_while_the_start_request_is_in_flight_cancels_the_job_when_the_id_arrives", async () => {
    let coz!: (id: string) => void;
    const k = kaynak({ start: () => new Promise<string>((r) => { coz = r; }), jobs: [is("running", ikili(), 1)] });
    const r = render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await act(async () => r.unmount()); // başlatma yanıtı henüz gelmedi
    expect(k.cancelJob).not.toHaveBeenCalled();
    await act(async () => coz("job-7"));
    expect(k.cancelJob).toHaveBeenCalledWith("job-7"); // yanıt gelir gelmez iptal (DELETE /api/jobs/job-7)
  });

  it("result_belongs_to_the_draft_it_was_run_for", async () => {
    const k = kaynak({ jobs: [is("done", ikili(), 104)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await yokla();
    expect(ozet().getByRole("table", { name: t("sart.ozet.tablo") })).toBeInTheDocument();
    // taslak değişince gösterilen sonuç artık gösterilen şarta ait değildir: gizlenir ve nedeni söylenir
    stopaj("15");
    expect(ozet().queryByRole("table")).toBeNull();
    expect(ozet().getByText(t("sart.ozet.onizleme_bayat"))).toBeInTheDocument();
    // yeniden çalıştırınca yeni taslağın sonucu gelir
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalledTimes(2));
    expect((k.startJob.mock.calls[1]![0] as PreviewSpec).draft.values).toEqual({ ucret_stopaji: 15 });
    await sonucaKadar(() => ozet().queryByRole("table") !== null);
    expect(ozet().getByRole("table", { name: t("sart.ozet.tablo") })).toBeInTheDocument();
    expect(ozet().queryByText(t("sart.ozet.onizleme_bayat"))).toBeNull();
  });

  it("a_draft_change_while_running_marks_the_coming_result_stale", async () => {
    const k = kaynak({ jobs: [is("running", ikili(), 10), is("done", ikili(), 104)] });
    render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await yokla();
    stopaj("15");
    // çalışırken henüz gizlenecek bir sonuç yok: not "gizlendi" demez, çalışan önizlemenin eski taslak için olduğunu söyler
    expect(ozet().getByText(t("sart.ozet.onizleme_bayat_calisan"))).toBeInTheDocument();
    expect(ozet().queryByText(t("sart.ozet.onizleme_bayat"))).toBeNull();
    await yokla();
    expect(ozet().queryByRole("table")).toBeNull();
    expect(ozet().getByText(t("sart.ozet.onizleme_bayat"))).toBeInTheDocument();
  });

  it.each([
    ["seed", { seedIndex: 1 }],
    ["template", { templateId: "baska_sablon" }],
    ["duration", { durationWeeks: 100 }],
    ["base_values", { baseValues: { kurulus_sermayesi: 5 } }],
  ] as const)("signature_covers_%s", async (_ad, degisen) => {
    const k = kaynak({ jobs: [is("done", ikili(), 104)] });
    const r = render(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} />);
    await hazir();
    fireEvent.click(baslat());
    await waitFor(() => expect(k.startJob).toHaveBeenCalled());
    await yokla();
    expect(ozet().getByRole("table", { name: t("sart.ozet.tablo") })).toBeInTheDocument();
    r.rerender(<Host source={k.source} onizleme init={{ ucret_stopaji: 12.5 }} baglam={degisen} />);
    expect(ozet().queryByRole("table")).toBeNull();
    expect(ozet().getByText(t("sart.ozet.onizleme_bayat"))).toBeInTheDocument();
  });
});

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

describe("Kurucu adım 2: etki önizlemesi bağlamı", () => {
  it("preview_uses_the_chosen_template_and_only_the_changed_rule_values", async () => {
    window.sessionStorage.clear();
    const registry = canliKayit();
    const info: SourceInfo = {
      kind: "live", modelNote: "x", seeds: [0, 1].map((i) => ({ index: i, label: 0.08 + i })), durationWeeks: 200,
      settings: [{ id: "gecis_destegi", options: ["kapali"].map((value) => ({ value, available: true })) }], fixedRules: [],
      templates: [{ id: "dayanikli_taban", values: { gecis_destegi: "kapali" } }], registry,
      capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false, jobs: true },
    };
    const startJob = vi.fn<(s: PreviewSpec) => Promise<string>>(async () => "job-9");
    const source = {
      kind: "live", capabilities: info.capabilities, info: async () => info, availability: async () => ({ ok: true, scenarioId: "k", blocked: [] }),
      startJob, job: async () => is9("running"), cancelJob: async () => is9("cancelled"), subscribe: () => () => {}, dispose: () => {},
    } as unknown as SimSource;
    render(<SimSourceProvider source={source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
    await screen.findByRole("heading", { name: t("kurucu.baslik") });
    fireEvent.change(screen.getByLabelText(t("kurucu.ad_etiket")), { target: { value: "Ada" } });
    fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t("kurucu.adim2.ad")) }));
    await screen.findByRole("region", { name: t("sart.editor") });
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: "12,5" } });
    const dugme = within(screen.getByRole("region", { name: t("sart.ozet.baslik") })).getByRole("button", { name: t("sart.ozet.onizleme_baslat") });
    await waitFor(() => expect(dugme).toBeEnabled());
    fireEvent.click(dugme);
    await waitFor(() => expect(startJob).toHaveBeenCalled());
    const spec = startJob.mock.calls[0]![0];
    expect([spec.base.templateId, spec.draft.templateId, spec.base.name, spec.weeks]).toEqual(["dayanikli_taban", "dayanikli_taban", "Ada", 52]);
    expect(spec.draft.values).toEqual({ ucret_stopaji: 12.5 });
    expect(spec.base.values).toEqual({});
  });
});

const is9 = (status: Job["status"]): Job => ({ jobId: "job-9", kind: "preview", status, progress: { done: 1, total: 104 }, members: [] });
