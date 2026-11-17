import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Availability, RunConfig, RunHandle, SimSource, SourceInfo } from "@/oyun/sim/types";
import { SartEditoru, type SartEditoruProps } from "@/oyun/screens/sart/SartEditoru";
import { useSartTaslak } from "@/oyun/screens/sart/useSartTaslak";
import { baglamKilitleri, katla, kartDurumu, sartGruplari, sartTabani } from "@/oyun/screens/sart/sartMantik";
import type { Registry, RegistryCard, SettingAvail, ValuesPatch } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";
import { ORNEK_BILINMEYEN, ORNEK_BILINMEYEN_BASLIK, contractRegistry, contractRegistryWithUnknown, withApply } from "../helpers/registryFixtures";

afterEach(() => cleanup());

/** Gerçek kayıtta "modelde sabit" (düzenlenemez, bilgi kartı olmayan) kart bulunmayabilir; kayıt büyüse ya da katman değişse de test kararlı kalsın diye türetilir. */
export const SABIT_KART = "ornek_sabit_deneme";
const baseReg = (): Registry => {
  const reg = contractRegistryWithUnknown();
  const model = reg.cards.find((c) => c.kind === "toggle" && c.layer === "P" && c.editable && c.status === "active" && c.params.length > 0) ?? reg.cards.find((c) => c.id === "ornek_acik")!;
  reg.cards = [...reg.cards, { ...model, id: SABIT_KART, title: "Sabit deneme kartı", editable: false, group: "kurtarma", level: "A", apply: "live", shows: undefined, aliases: [] }];
  return reg;
};
const kurallar = (reg: Registry): RegistryCard[] => reg.cards.filter((c) => c.layer === "P");

type Over = Partial<Pick<SartEditoruProps, "mode" | "settings">> & { registry?: Registry; init?: ValuesPatch; onDraft?: (d: ValuesPatch) => void; templateValues?: ValuesPatch };

/** Denetimli sarmal: taslağı tutar ve `onDraft`ı iletir. */
function Host({ registry = baseReg(), init = {}, mode = "builder", settings, onDraft, templateValues = {} }: Over) {
  const base = sartTabani(registry, templateValues);
  const [patch, setPatch] = useState<ValuesPatch>(init);
  return (
    <SartEditoru
      mode={mode} registry={registry} base={base} draft={{ ...base, ...patch }} context={{ durationWeeks: 200 }}
      {...(settings ? { settings } : {})}
      onDraft={(next) => {
        setPatch(next);
        onDraft?.(next);
      }}
    />
  );
}

const grupDugmesi = (title: string) => within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: new RegExp(title) });
const kart = (title: string) => screen.getByRole("article", { name: title });
const ara = (q: string) => fireEvent.change(screen.getByRole("searchbox", { name: t("sart.ara") }), { target: { value: q } });
const uzmanDugmesi = () => screen.queryByRole("button", { name: /^(Göster|Gizle) \(\d+\)$/ });

describe("Şart editörü: erişim", () => {
  it("every_P_card_reachable", () => {
    const reg = baseReg();
    render(<Host registry={reg} />);
    const nav = screen.getByRole("navigation", { name: t("sart.gruplar") });
    const seen = new Set<string>();
    for (const btn of within(nav).getAllByRole("button")) {
      fireEvent.click(btn);
      const toggle = uzmanDugmesi();
      if (toggle && toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
      for (const h of screen.getAllByRole("article")) seen.add(h.getAttribute("aria-labelledby") ? document.getElementById(h.getAttribute("aria-labelledby")!)!.textContent! : "");
    }
    for (const c of kurallar(reg)) expect(seen, c.id).toContain(c.title);
    // B/C katmanı kartları (V, Y) Kurallar'da yer almaz
    expect(seen.has("Örnek tutar")).toBe(false);
    expect(seen.has("Başlangıç dünyası")).toBe(false);
  });

  it("every_P_card_reachable_by_search_and_lands_on_card", () => {
    const reg = baseReg();
    render(<Host registry={reg} />);
    for (const c of kurallar(reg)) {
      ara(c.title);
      const list = screen.getByRole("list", { name: t("sart.ara_sonuclar") });
      const btn = within(list).getAllByRole("button").find((b) => within(b).queryByText(c.title))!;
      expect(btn, c.id).toBeTruthy();
      fireEvent.click(btn);
      expect(kart(c.title), c.id).toBeInTheDocument();
    }
  }, 20000); // kayıt büyüdükçe kart sayısı artar: bu test her kart için arama + gezinme yapar, yük altında 5 sn varsayılanını aşabilir

  it("group_without_registry_entry_falls_to_diger", () => {
    const reg = baseReg();
    reg.cards = [...reg.cards, { ...reg.cards.find((c) => c.id === "ucret_stopaji")!, id: "yetim", title: "Yetim kural", group: "yok_boyle_grup", aliases: [] }];
    render(<Host registry={reg} />);
    fireEvent.click(grupDugmesi(t("sart.grup_diger")));
    expect(kart("Yetim kural")).toBeInTheDocument();
  });

  it("empty_groups_have_no_tab", () => {
    const reg = baseReg();
    reg.cards = reg.cards.filter((c) => !(c.layer === "P" && c.group === "dunya"));      // D4 öncesi: "dunya" grubunda yalnız Y/V/S kartı var
    render(<Host registry={reg} />);
    const names = within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getAllByRole("button").map((b) => b.textContent);
    expect(names.some((n) => /\. Dünya$/.test(n ?? ""))).toBe(false);
  });

  it("world_group_tab_exists_with_population_cards", () => {
    render(<Host />);
    const names = within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getAllByRole("button").map((b) => b.textContent);
    expect(names.some((n) => /\. Dünya$/.test(n ?? ""))).toBe(true);      // D4: şehir başına oyuncu, NPC nüfusu, başlangıç şehir kasası
  });

  it("groups_follow_registry_order_and_are_numbered", () => {
    const reg = baseReg();
    const gruplar = sartGruplari(reg, "Diğer");
    const beklenen = [...reg.groups].sort((a, b) => a.order - b.order).map((g) => g.id).filter((id) => reg.cards.some((c) => c.layer === "P" && c.group === id));
    expect(gruplar.map((g) => g.id)).toEqual(beklenen);
    expect(beklenen.slice(0, 3)).toEqual(["para_faiz", "kredi", "bankacilik"]);
    render(<Host registry={reg} />);
    const btns = within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getAllByRole("button");
    expect(btns[0]).toHaveTextContent("1. Para ve faiz");
    expect(btns[0]).toHaveAttribute("aria-current", "page");
    expect(btns[1]).not.toHaveAttribute("aria-current");
  });
});

describe("Şart editörü: arama", () => {
  it("search_finds_old_name_alias", () => {
    render(<Host />);
    ara("Ücretten gelir vergisi");
    const list = screen.getByRole("list", { name: t("sart.ara_sonuclar") });
    expect(within(list).getByText("Ücret stopajı")).toBeInTheDocument();
    expect(within(list).getByText(t("sart.ara_yer", { grup: "Vergiler" }))).toBeInTheDocument();
  });

  it("search_finds_by_group_name", () => {
    render(<Host />);
    ara("bankacılık");
    const list = screen.getByRole("list", { name: t("sart.ara_sonuclar") });
    expect(within(list).getByText("Lonca kredi sınırı")).toBeInTheDocument();
    expect(within(list).getByText("Kasada tutulacak mevduat")).toBeInTheDocument();
  });

  it("search_turkish_case_fold", () => {
    expect(katla("İSTANBUL ISPARTA")).toBe(katla("istanbul ısparta"));
    expect(katla("ÇIĞ ÖĞÜT ŞEKER")).toBe("cig ogut seker");
    render(<Host />);
    ara("ÜCRET STOPAJI"); // I -> ı: "stopajı"
    expect(within(screen.getByRole("list", { name: t("sart.ara_sonuclar") })).getByText("Ücret stopajı")).toBeInTheDocument();
    ara("KURUMLAR VERGİSİ"); // İ -> i
    expect(within(screen.getByRole("list", { name: t("sart.ara_sonuclar") })).getByText("Kurumlar vergisi")).toBeInTheDocument();
    ara("ucret stopaji"); // aksansız yazım
    expect(within(screen.getByRole("list", { name: t("sart.ara_sonuclar") })).getByText("Ücret stopajı")).toBeInTheDocument();
  });

  it("search_one_char_shows_nothing_and_no_result_message", () => {
    render(<Host />);
    ara("ü");
    expect(screen.queryByRole("list", { name: t("sart.ara_sonuclar") })).toBeNull();
    ara("zzzyok");
    expect(screen.getByText(t("sart.ara_yok"))).toBeInTheDocument();
  });

  it("search_result_opens_expert_card_and_focuses_it", () => {
    render(<Host />);
    expect(screen.queryByRole("article", { name: "Servet vergisi" })).toBeNull();
    ara("servet");
    fireEvent.click(within(screen.getByRole("list", { name: t("sart.ara_sonuclar") })).getByRole("button", { name: /Servet vergisi/ }));
    const card = kart("Servet vergisi");
    expect(card).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Servet vergisi" })).toHaveFocus();
    expect(grupDugmesi("Vergiler")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("list", { name: t("sart.ara_sonuclar") })).toBeNull();
  });
});

describe("Şart editörü: uzman ayarları", () => {
  it("expert_cards_hidden_until_toggle", () => {
    render(<Host />);
    fireEvent.click(grupDugmesi("Vergiler"));
    expect(kart("Ücret stopajı")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Servet vergisi" })).toBeNull();
    const n = kurallar(baseReg()).filter((c) => c.group === "vergi" && c.level === "U").length;
    const toggle = screen.getByRole("button", { name: t("sart.uzman_goster", { n }) });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(kart("Servet vergisi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("sart.uzman_gizle", { n }) })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: t("sart.uzman_gizle", { n }) }));
    expect(screen.queryByRole("article", { name: "Servet vergisi" })).toBeNull();
  });

  it("group_without_expert_cards_has_no_toggle", () => {
    render(<Host />);
    fireEvent.click(grupDugmesi("Bankacılık"));
    expect(uzmanDugmesi()).toBeNull();
  });
});

describe("Şart editörü: değiştirdiğin şeridi", () => {
  it("changed_strip_counts_and_lists", () => {
    const reg = baseReg();
    const toplam = kurallar(reg).length;
    render(<Host registry={reg} />);
    expect(screen.getByText(t("sart.serit", { n: toplam, m: 0 }))).toBeInTheDocument();
    expect(screen.getByText(t("sart.degisen_yok"))).toBeInTheDocument();
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: "12,5" } });
    expect(screen.getByText(t("sart.serit", { n: toplam, m: 1 }))).toBeInTheDocument();
    const liste = screen.getByRole("list", { name: t("sart.degisenler") });
    expect(within(liste).getByRole("button", { name: t("sart.fark", { ad: "Ücret stopajı", eski: "%10", yeni: "%12,5" }) })).toBeInTheDocument();
    fireEvent.change(within(kart("Kurumlar vergisi")).getByRole("textbox"), { target: { value: "25" } });
    expect(screen.getByText(t("sart.serit", { n: toplam, m: 2 }))).toBeInTheDocument();
    expect(within(liste).getAllByRole("listitem")).toHaveLength(2);
    // grup sekmesi değişen sayısını gösterir ve okunur
    expect(within(grupDugmesi("Vergiler")).getByLabelText(t("sart.grup_degisen", { n: 2 }))).toBeInTheDocument();
    expect(within(grupDugmesi("Kredi")).queryByLabelText(/değişen/)).toBeNull();
  });

  it("changed_strip_item_jumps_to_card_and_reset_returns", () => {
    render(<Host />);
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: "12,5" } });
    fireEvent.click(grupDugmesi("Kredi"));
    expect(screen.queryByRole("article", { name: "Ücret stopajı" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ücret stopajı: %10 → %12,5/ }));
    const card = kart("Ücret stopajı");
    expect(within(card).getByRole("heading", { name: "Ücret stopajı" })).toHaveFocus();
    fireEvent.click(within(card.parentElement!).getByRole("button", { name: t("sart.sifirla") }));
    expect(screen.getByText(t("sart.degisen_yok"))).toBeInTheDocument();
    expect(within(kart("Ücret stopajı")).getByRole("textbox")).toHaveValue("10");
  });

  it("template_values_are_base_not_changes", () => {
    render(<Host templateValues={{ ucret_stopaji: 15 }} />);
    expect(screen.getByText(t("sart.degisen_yok"))).toBeInTheDocument();
    fireEvent.click(grupDugmesi("Vergiler"));
    expect(within(kart("Ücret stopajı")).getByRole("textbox")).toHaveValue("15");
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: /Ücret stopajı: %15 → %10/ })).toBeInTheDocument();
  });
});

describe("Şart editörü: kilit kuralları (DK-17)", () => {
  it("locked_card_keyboard_reachable_with_reason", () => {
    render(<Host />);
    const heading = within(kart(ORNEK_BILINMEYEN_BASLIK)).getByRole("heading", { name: ORNEK_BILINMEYEN_BASLIK });
    expect(heading).toHaveAttribute("tabindex", "0");
    expect(heading).toHaveAccessibleDescription(new RegExp(t("kart.dogrulanmadi")));
    heading.focus();
    expect(heading).toHaveFocus();
    expect(within(kart(ORNEK_BILINMEYEN_BASLIK)).getByRole("textbox")).toBeDisabled();
  });

  it("unknown_card_locked_in_builder", () => {
    const onDraft = vi.fn();
    render(<Host onDraft={onDraft} />);
    const c = kart(ORNEK_BILINMEYEN_BASLIK);
    expect(within(c).getByRole("textbox")).toHaveAccessibleDescription(new RegExp(t("kart.dogrulanmadi")));
    fireEvent.change(within(c).getByRole("textbox"), { target: { value: "5" } });
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("unknown_overrides_recording_reason", () => {
    const settings: SettingAvail[] = [{ id: ORNEK_BILINMEYEN, options: [], changeable: false, reason: "no_recording" }];
    render(<Host settings={settings} />);
    const input = within(kart(ORNEK_BILINMEYEN_BASLIK)).getByRole("textbox");
    expect(input).toHaveAccessibleDescription(new RegExp(t("kart.dogrulanmadi")));
    expect(input).not.toHaveAccessibleDescription(new RegExp(t("kart.kayit_yok")));
  });

  it("start_only_card_open_in_builder", () => {
    const onDraft = vi.fn();
    render(<Host onDraft={onDraft} />);
    fireEvent.click(grupDugmesi("Kurtarma ve geçiş"));
    fireEvent.click(screen.getByRole("button", { name: /^Göster \(\d+\)$/ }));
    const c = kart("Örnek faiz");
    const input = within(c).getByRole("textbox");
    expect(input).toBeEnabled();
    expect(within(c).queryByText(t("lock.yeni_kosu"))).toBeNull();
    fireEvent.change(input, { target: { value: "0,5" } });
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ ornek_faiz: 0.5 }));
  });

  it("start_only_card_locked_in_live_mode_with_reason", () => {
    const onDraft = vi.fn();
    render(<Host mode="live" onDraft={onDraft} />);
    fireEvent.click(grupDugmesi("Kurtarma ve geçiş"));
    fireEvent.click(screen.getByRole("button", { name: /^Göster \(\d+\)$/ }));
    const c = kart("Örnek faiz");
    expect(within(c).getByRole("textbox")).toBeDisabled();
    expect(within(c).getByRole("textbox")).toHaveAccessibleDescription(new RegExp(t("lock.yeni_kosu")));
    // live ve live_sync kartlar açık
    expect(within(kart("Örnek anahtar")).getAllByRole("button")[0]).toBeEnabled();
  });

  it("recording_missing_card_locked_with_kayit_yok", () => {
    const settings: SettingAvail[] = [
      { id: "ucret_stopaji", options: [], changeable: false, reason: "no_recording" },
      { id: "kurumlar_vergisi", options: [] },
    ];
    render(<Host settings={settings} />);
    fireEvent.click(grupDugmesi("Vergiler"));
    const c = kart("Ücret stopajı");
    expect(within(c).getByRole("textbox")).toBeDisabled();
    expect(within(c).getByRole("textbox")).toHaveAccessibleDescription(new RegExp(t("kart.kayit_yok")));
    expect(within(kart("Kurumlar vergisi")).getByRole("textbox")).toBeEnabled();
  });

  it("passive_card_never_sends_value", () => {
    const reg = baseReg();
    reg.cards = reg.cards.map((c) => (c.id === "kurumlar_vergisi" ? { ...c, status: "passive" as const } : c));
    const onDraft = vi.fn();
    render(<Host registry={reg} onDraft={onDraft} />);
    fireEvent.click(grupDugmesi("Vergiler"));
    const c = kart("Kurumlar vergisi");
    expect(within(c).getByText(t("rozet.passive"))).toBeInTheDocument();
    expect(within(c).getByRole("textbox")).toBeDisabled();
    fireEvent.change(within(c).getByRole("textbox"), { target: { value: "30" } });
    fireEvent.keyDown(within(c).getByRole("textbox"), { key: "ArrowUp" });
    expect(onDraft).not.toHaveBeenCalled();
    expect(screen.getByText(t("sart.degisen_yok"))).toBeInTheDocument();
  });

  it("fixed_card_locked_with_fixed_reason_and_info_card_has_no_control", () => {
    render(<Host mode="live" />);
    fireEvent.click(grupDugmesi("Kurtarma ve geçiş"));
    const z = kart("Sabit deneme kartı");
    expect(within(z).getByText(t("sart.kilit_sabit"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Göster \(\d+\)$/ }));
    const info = kart("Örnek salt okunur");
    expect(within(info).getByText(t("sart.salt_okunur"))).toBeInTheDocument();
    expect(within(info).getByText("12 kat")).toBeInTheDocument();
    expect(within(info).queryAllByRole("button")).toHaveLength(0);
    expect(within(info).queryByText(t("rozet.passive"))).toBeNull();
  });

  it("withApply_changes_class_and_unknown_is_locked_everywhere_while_live_is_editable_in_live", () => {
    const reg = baseReg();
    const sinif = (apply: Parameters<typeof withApply>[2], mode: "builder" | "live") => kartDurumu(withApply(reg, "ucret_stopaji", apply).cards.find((c) => c.id === "ucret_stopaji")!, mode);
    expect(sinif("unknown", "builder")).toEqual({ state: "locked", lockReason: "unverified" });
    expect(sinif("unknown", "live")).toEqual({ state: "locked", lockReason: "unverified" });
    expect(sinif("start_only", "builder")).toEqual({ state: "active" });
    expect(sinif("start_only", "live")).toEqual({ state: "locked", lockReason: "start_only" });
    expect(sinif("live", "live")).toEqual({ state: "active" });
    expect(reg.cards.find((c) => c.id === "ucret_stopaji")!.apply).toBe("live"); // özgün kayıt değişmez
  });

  it("kartDurumu_baglam_kilidi_no_cash_floor_ve_baglamKilitleri", () => {
    const reg = baseReg();
    const kart = reg.cards.find((c) => c.id === "ucret_stopaji")!;
    const ayar = { id: "ucret_stopaji", options: [{ value: "a", available: true }], changeable: false, reason: "no_cash_floor" as const };
    expect(kartDurumu(kart, "live", ayar)).toEqual({ state: "locked", lockReason: "no_cash_floor" });
    // koşu durumunun bildirdiği kilitler ayarlara işlenir: var olan ayar değişir (seçenekler korunur), olmayan eklenir, kilit yoksa liste aynı kalır
    const mevcut = [{ id: "ucret_stopaji", options: [{ value: "a", available: true }] }, { id: "baska", options: [] }];
    const sonuc = baglamKilitleri(mevcut, [{ id: "ucret_stopaji", reason: "no_cash_floor" }, { id: "yeni", reason: "no_cash_floor" }]);
    expect(sonuc.find((x) => x.id === "ucret_stopaji")).toEqual({ id: "ucret_stopaji", options: [{ value: "a", available: true }], changeable: false, reason: "no_cash_floor" });
    expect(sonuc.find((x) => x.id === "yeni")).toEqual({ id: "yeni", options: [], changeable: false, reason: "no_cash_floor" });
    expect(sonuc.find((x) => x.id === "baska")).toEqual({ id: "baska", options: [] });
    expect(baglamKilitleri(mevcut, undefined)).toBe(mevcut);
    expect(baglamKilitleri(mevcut, [])).toBe(mevcut);
  });

  it("kartDurumu_precedence_table", () => {
    const reg = baseReg();
    const by = (id: string): RegistryCard => reg.cards.find((c) => c.id === id)!;
    expect(kartDurumu(by("ucret_stopaji"), "builder")).toEqual({ state: "active" });
    expect(kartDurumu(by(ORNEK_BILINMEYEN), "live")).toEqual({ state: "locked", lockReason: "unverified" });
    expect(kartDurumu(by("ornek_faiz"), "builder")).toEqual({ state: "active" });
    expect(kartDurumu(by("ornek_faiz"), "live")).toEqual({ state: "locked", lockReason: "start_only" });
    expect(kartDurumu(by("ornek_sira"), "live").lockReason).toBe("start_only");
    expect(kartDurumu(by("ornek_oncelik"), "live")).toEqual({ state: "active" });
    expect(kartDurumu(by(SABIT_KART), "builder")).toEqual({ state: "locked", lockReason: "fixed" });
    expect(kartDurumu(by("ucret_stopaji"), "builder", { id: "ucret_stopaji", options: [], changeable: false, reason: "start_only" })).toEqual({ state: "active" });
    expect(kartDurumu(by("ucret_stopaji"), "live", { id: "ucret_stopaji", options: [], changeable: false, reason: "start_only" })).toEqual({ state: "locked", lockReason: "start_only" });
    expect(kartDurumu(by("ucret_stopaji"), "builder", { id: "ucret_stopaji", options: [], changeable: false, reason: "passive" }).state).toBe("passive");
    expect(kartDurumu(by("ucret_stopaji"), "builder", { id: "ucret_stopaji", options: [], changeable: false })).toEqual({ state: "locked", lockReason: "locked" });
  });
});

describe("Şart editörü: yapı ve başlık düzeyleri", () => {
  it("group_title_h3_and_card_titles_h4", () => {
    render(<Host />);
    expect(screen.getByRole("heading", { level: 3, name: /^1\. / })).toBeInTheDocument();
    expect(within(kart(ORNEK_BILINMEYEN_BASLIK)).getByRole("heading", { level: 4 })).toBeInTheDocument();
  });

  it("uzman_button_has_visible_group_label_and_short_name", () => {
    render(<Host />);
    fireEvent.click(grupDugmesi("Vergiler"));
    expect(screen.getByText(t("sart.uzman_baslik"))).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /^Göster \(\d+\)$/ });
    expect(btn).toHaveAccessibleDescription(t("sart.uzman_baslik"));
  });

  it("gecis_card_in_editor_shows_availability_block_and_old_measure_note", () => {
    const reg = baseReg();
    const base = sartTabani(reg, {});
    const blocked = { ok: false, scenarioId: null, blocked: [{ settingId: "gecis_destegi", option: "kapali", reason: "no_recording" as const }] };
    render(
      <SimSourceProvider source={createFakeSource([], { kind: "replay" })}>
        <SartEditoru mode="builder" registry={reg} base={base} draft={base} onDraft={() => {}} context={{ durationWeeks: 200 }} gecis={{ availability: blocked }} />
      </SimSourceProvider>,
    );
    fireEvent.click(grupDugmesi("Kurtarma ve geçiş"));
    const c = kart("Geçiş desteği");
    expect(within(c).getByText(t("lock.kayitsiz"))).toBeInTheDocument();
    expect(within(c).getByText(t("setting.gecis_destegi.eski_olcum"))).toBeInTheDocument();
  });

  it("gecis_card_heading_is_h4_in_editor_and_search_focuses_it", () => {
    const reg = baseReg();
    const base = sartTabani(reg, {});
    const ok = { ok: true, scenarioId: "k", blocked: [] };
    render(
      <SimSourceProvider source={createFakeSource([], { kind: "replay" })}>
        <SartEditoru mode="builder" registry={reg} base={base} draft={base} onDraft={() => {}} context={{ durationWeeks: 200 }} gecis={{ availability: ok }} />
      </SimSourceProvider>,
    );
    ara("Geçiş desteği");
    const list = screen.getByRole("list", { name: t("sart.ara_sonuclar") });
    fireEvent.click(within(list).getAllByRole("button").find((b) => within(b).queryByText("Geçiş desteği"))!);
    const baslik = screen.getByRole("heading", { name: "Geçiş desteği", level: 4 });
    expect(document.activeElement).toBe(baslik);
    expect(screen.queryByRole("heading", { name: "Geçiş desteği", level: 3 })).toBeNull();
  });

  it("layer_tab_group_nav_and_panel_labelled", () => {
    render(<Host />);
    const tab = screen.getByRole("tab", { name: new RegExp(t("sart.katman_kurallar")) });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(tab.getAttribute("aria-controls")!)).toHaveAttribute("role", "tabpanel");
    expect(screen.getByRole("region", { name: t("sart.editor") })).toBeInTheDocument();
  });

  it("registry_without_rule_cards_renders_without_crash", () => {
    const reg = baseReg();
    reg.cards = reg.cards.filter((c) => c.layer !== "P");
    render(<Host registry={reg} />);
    expect(screen.getByText(t("sart.serit", { n: 0, m: 0 }))).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});

// --- Kurucu'ya bağlantı (adım 2) ---

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

function kurucuKaynagi(over: Partial<SourceInfo> = {}) {
  const info: SourceInfo = {
    kind: "replay", modelNote: "x", seeds: [0, 1, 2, 3, 4, 5].map((i) => ({ index: i, label: 0.078 + i * 0.002 })), durationWeeks: 200,
    settings: [{ id: "gecis_destegi", options: ["kapali", "kisa_sureli", "kurtarma_fonuyla"].map((value) => ({ value, available: true })) }],
    fixedRules: [{ settingId: "ucret_stopaji", valueKey: "lock.deger.ucret_stopaji" }],
    templates: [{ id: "dayanikli_taban", values: { gecis_destegi: "kapali", [ORNEK_BILINMEYEN]: 3 } }],
    registry: contractRegistryWithUnknown(),
    ...over,
  };
  const availability = vi.fn<(v: ValuesPatch) => Promise<Availability>>(async () => ({ ok: true, scenarioId: "k", blocked: [] }));
  const start = vi.fn(async (c: RunConfig): Promise<RunHandle> => ({
    runId: "y1", state: { runId: "y1", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "kapali", name: c.name, cityNames: c.cityNames },
  }));
  const source = {
    kind: "replay", capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => info, availability,
    start, open: async () => null, subscribe: () => () => {}, control: vi.fn(), applyChange: vi.fn(), weeks: vi.fn(), dispose: () => {},
  } as unknown as SimSource;
  return { source, start, availability };
}

const taslakKur = (values: ValuesPatch) => window.sessionStorage.setItem("oyun.kurucu.taslak", JSON.stringify({ name: "Ada", cities: ["a", "b", "c", "d", "e"], templateId: null, values, scenarioId: null, durationWeeks: null, seedIndex: null, goals: [] }));

async function kurucuAc(over: Partial<SourceInfo> = {}) {
  const k = kurucuKaynagi(over);
  render(<SimSourceProvider source={k.source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
  await screen.findByRole("heading", { name: t("kurucu.baslik") });
  fireEvent.change(screen.getByLabelText(t("kurucu.ad_etiket")), { target: { value: "Ada" } });
  fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t("kurucu.adim2.ad")) }));
  await screen.findByRole("region", { name: t("sart.editor") });
  return k;
}

describe("useSartTaslak", () => {
  it("set_ignores_locked_and_passive_cards_and_equal_to_base_is_not_a_change", () => {
    const reg = baseReg();
    const base = sartTabani(reg, {});
    const { result } = renderHook(() => useSartTaslak(reg, base, {}, { mode: "builder" }));
    act(() => result.current.set(ORNEK_BILINMEYEN, 9)); // unknown
    act(() => result.current.set(SABIT_KART, false)); // sabit
    expect(result.current.diff()).toEqual([]);
    act(() => result.current.set("ucret_stopaji", 12.5));
    expect(result.current.diff()).toEqual([{ id: "ucret_stopaji", from: 10, to: 12.5 }]);
    act(() => result.current.set("ucret_stopaji", 10));
    expect(result.current.diff()).toEqual([]);
    act(() => result.current.set("kurumlar_vergisi", 30));
    act(() => result.current.reset("kurumlar_vergisi"));
    expect(result.current.draft.kurumlar_vergisi).toBe(base.kurumlar_vergisi);
  });

  it("start_only_open_in_builder_locked_in_live", () => {
    const reg = baseReg();
    const base = sartTabani(reg, {});
    const b = renderHook(() => useSartTaslak(reg, base, {}, { mode: "builder" }));
    act(() => b.result.current.set("ornek_faiz", 0.5));
    expect(b.result.current.diff().map((d) => d.id)).toEqual(["ornek_faiz"]);
    const l = renderHook(() => useSartTaslak(reg, base, {}, { mode: "live" }));
    act(() => l.result.current.set("ornek_faiz", 0.5));
    expect(l.result.current.diff()).toEqual([]);
  });
});

describe("Kurucu adım 2: Şart editörü", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.location.hash = "#/kurucu";
  });

  it("builder_draft_flows_to_start_config", async () => {
    const { start } = await kurucuAc();
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: "12,5" } });
    fireEvent.click(grupDugmesi("Kurtarma ve geçiş"));
    fireEvent.click(screen.getByRole("button", { name: /^Göster \(\d+\)$/ }));
    fireEvent.click(within(kart("Örnek anahtar")).getByRole("button", { name: "açık" }));
    fireEvent.change(within(kart("Örnek faiz")).getByRole("textbox"), { target: { value: "0,5" } }); // start_only: Kurucu'da açık
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const cfg = start.mock.calls[0]![0];
    // şablondan fark + şablonun kendi (açık) değerleri; unknown kart (şablon doldursa bile) hiç gönderilmez
    expect(cfg.values).toEqual({ gecis_destegi: "kapali", ucret_stopaji: 12.5, ornek_acik: true, ornek_faiz: 0.5 });
    expect(cfg.values).not.toHaveProperty(ORNEK_BILINMEYEN);
    expect(cfg.templateId).toBe("dayanikli_taban");
  });

  it("unknown_and_passive_cards_never_sent_even_if_template_fills_them", async () => {
    const { start } = await kurucuAc({ templates: [{ id: "dayanikli_taban", values: { gecis_destegi: "kapali", [ORNEK_BILINMEYEN]: 3, kredi_varyant: true, ornek_tahvil: { acik: true, vade: 52, tavan: 52 } } }] });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].values).toEqual({ gecis_destegi: "kapali" });
  });

  it("draft_survives_step_changes", async () => {
    await kurucuAc();
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: "12,5" } });
    const adim = (n: number) => fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t(`kurucu.adim${n}.ad` as "kurucu.adim0.ad")) }));
    adim(0);
    adim(2);
    fireEvent.click(grupDugmesi("Vergiler"));
    expect(within(kart("Ücret stopajı")).getByRole("textbox")).toHaveValue("12,5");
    expect(screen.getByText(t("sart.serit", { n: kurallar(contractRegistryWithUnknown()).length, m: 1 }))).toBeInTheDocument();
  });

  it("starting_world_picker_moved_to_step_3", async () => {
    await kurucuAc();
    expect(screen.queryByRole("button", { name: "Dünya 3" })).toBeNull(); // W7: Başlangıç dünyası adım 3'e taşındı
    expect(screen.queryByText(t("kurucu.adim2.giris_kilitli"))).toBeNull();
  });

  it("without_registry_step_2_falls_back_to_locked_cards", async () => {
    const k = kurucuKaynagi();
    const { registry: _kayit, ...bare } = await k.source.info();
    void _kayit;
    k.source.info = async () => bare;
    render(<SimSourceProvider source={k.source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
    await screen.findByRole("heading", { name: t("kurucu.baslik") });
    fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t("kurucu.adim2.ad")) }));
    expect(await screen.findByText(t("kurucu.adim2.giris_kilitli"))).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t("sart.editor") })).toBeNull();
  });

  it("editing_a_rule_keeps_template_values_of_non_rule_cards", async () => {
    const registry = contractRegistry();
    registry.cards = registry.cards.map((c) => (c.id === "ornek_akce" ? { ...c, apply: "live" as const } : c));
    const { start } = await kurucuAc({ registry, templates: [{ id: "dayanikli_taban", values: { gecis_destegi: "kapali", ornek_akce: 5000 } }] });
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Ücret stopajı")).getByRole("textbox"), { target: { value: "12,5" } });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].values).toEqual({ gecis_destegi: "kapali", ornek_akce: 5000, ucret_stopaji: 12.5 });
  });

  it("stored_draft_is_filtered_by_the_shared_card_rule", async () => {
    taslakKur({ ucret_stopaji: 12.5, bilinmeyen_anahtar: 7, [ORNEK_BILINMEYEN]: 9, kurumlar_vergisi: 25 });
    const settings: SettingAvail[] = [
      { id: "gecis_destegi", options: [{ value: "kapali", available: true }] },
      { id: "ucret_stopaji", options: [], changeable: false, reason: "no_recording" },
    ];
    const { start, availability } = await kurucuAc({ settings });
    const toplam = kurallar(contractRegistryWithUnknown()).length;
    // şerit yalnız gönderilecek değişikliği sayar
    expect(screen.getByText(t("sart.serit", { n: toplam, m: 1 }))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ücret stopajı: / })).toBeNull();
    // süzülen kalemler için bilgi ve atma yolu (sessiz yutma yok)
    expect(screen.getByText(t("sart.suzulen", { n: 3 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("sart.suzulen_at") }));
    expect(screen.queryByText(t("sart.suzulen", { n: 3 }))).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak")!).values).toEqual({ kurumlar_vergisi: 25 });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const cfg = start.mock.calls[0]![0];
    expect(cfg.values).toEqual({ gecis_destegi: "kapali", kurumlar_vergisi: 25 });
    expect(cfg.templateId).toBe("dayanikli_taban"); // şablonun kilitli kart değerlerini sunucu templateId ile kendisi uygular
    for (const call of availability.mock.calls) expect(Object.keys(call[0]).sort()).toEqual(["gecis_destegi", "kurumlar_vergisi"]);
  });

  it("editing_keeps_filtered_rule_values_and_the_band_count", async () => {
    taslakKur({ ucret_stopaji: 12.5, [ORNEK_BILINMEYEN]: 9, kurumlar_vergisi: 25 });
    await kurucuAc();
    // sentetik unknown kart kilitli: süzülür, bant bunu bildirir
    expect(screen.getByText(t("sart.suzulen", { n: 1 }))).toBeInTheDocument();
    fireEvent.click(grupDugmesi("Vergiler"));
    fireEvent.change(within(kart("Kurumlar vergisi")).getByRole("textbox"), { target: { value: "30" } });
    // düzenleme süzülen değeri sessizce düşürmez; bant sayısı aynı kalır
    expect(screen.getByText(t("sart.suzulen", { n: 1 }))).toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak")!).values).toEqual({ ucret_stopaji: 12.5, [ORNEK_BILINMEYEN]: 9, kurumlar_vergisi: 30 });
    fireEvent.click(screen.getByRole("button", { name: t("sart.suzulen_at") }));
    expect(JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak")!).values).toEqual({ ucret_stopaji: 12.5, kurumlar_vergisi: 30 });
  });

  it("locked_card_never_shows_stored_value_and_has_no_changed_marker", async () => {
    taslakKur({ ucret_stopaji: 12.5 });
    await kurucuAc({ settings: [{ id: "ucret_stopaji", options: [], changeable: false, reason: "no_recording" }] });
    fireEvent.click(grupDugmesi("Vergiler"));
    expect(within(kart("Ücret stopajı")).getByRole("textbox")).toHaveValue("10");
  });
});
