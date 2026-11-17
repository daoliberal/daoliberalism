import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { RuleCard, type RuleCardProps } from "@/oyun/ui/RuleCard";
import type { Registry, RegistryCard, UIValue, ValuesPatch } from "@/oyun/sim/types";
import { contractRegistry } from "../helpers/registryFixtures";

const reg: Registry = contractRegistry();
const card = (id: string): RegistryCard => reg.cards.find((c) => c.id === id)!;

type Over = Partial<Omit<RuleCardProps, "card" | "registry">>;
/** Değeri ve taslağı tutan sarmal; `onChange` her değişikliği iletir. */
function Host({ id, init, onChange, durationWeeks = 200, over: cardOver, ...over }: { id: string; init?: UIValue; onChange?: (v: UIValue) => void; durationWeeks?: number; over?: Partial<RegistryCard> } & Over) {
  const c = { ...card(id), ...cardOver };
  const [value, setValue] = useState<UIValue>(init ?? c.default);
  const draft: ValuesPatch = { [id]: value };
  return (
    <RuleCard
      card={c} registry={reg} value={value} draft={draft} durationWeeks={durationWeeks} state="active"
      {...over}
      onChange={(v) => { setValue(v); onChange?.(v); }}
    />
  );
}

describe("RuleCard", () => {
  it("ruleCard_basis_shown_only_when_present", () => {
    const { unmount } = render(<Host id="ornek_tahvil" />);
    expect(screen.getByText(t("kart.dayanak"))).toBeInTheDocument();
    expect(screen.getByText("Caiani ve ark. 2016")).toBeInTheDocument();
    expect(screen.getByText("Devlet bloğu.")).toBeInTheDocument();
    unmount();
    render(<Host id="ornek_faiz" />);
    expect(screen.queryByText(t("kart.dayanak"))).toBeNull();
  });

  it("ruleCard_shows_what_changes_hint_rows", () => {
    render(<Host id="ornek_faiz" init={0.3} durationWeeks={100} />);
    expect(screen.getByRole("heading", { name: "Örnek faiz" })).toBeInTheDocument();
    for (const k of ["card.what", "card.changes", "card.hint"] as const) expect(screen.getByText(t(k))).toBeInTheDocument();
    expect(screen.getByText("Haftalık oran.")).toBeInTheDocument();
    expect(screen.getByText("6 başlangıç dünyasında ölçüldü.")).toBeInTheDocument();
    expect(screen.queryByText(t("kart.olculmedi"))).toBeNull();
  });

  it("ruleCard_hint_replaced_when_unmeasured", async () => {
    render(<Host id="ornek_faiz" init={0.3} durationWeeks={100} />);
    expect(screen.getByText("6 başlangıç dünyasında ölçüldü.")).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "0.4" } });
    expect(screen.getByText(t("kart.olculmedi"))).toBeInTheDocument();
    expect(screen.queryByText("6 başlangıç dünyasında ölçüldü.")).toBeNull();
    fireEvent.change(input, { target: { value: "0.3" } });
    expect(screen.getByText("6 başlangıç dünyasında ölçüldü.")).toBeInTheDocument();
    expect(screen.queryByText(t("kart.olculmedi"))).toBeNull();
  });

  it("ruleCard_hint_replaced_when_context_differs", () => {
    const { rerender } = render(<Host id="ornek_faiz" init={0.3} durationWeeks={200} />);
    expect(screen.getByText(t("kart.olculmedi"))).toBeInTheDocument(); // süre farklı
    rerender(<RuleCard card={card("ornek_faiz")} registry={reg} value={0.3} draft={{ ornek_faiz: 0.3, ornek_acik: true }} durationWeeks={100} state="active" onChange={() => {}} />);
    expect(screen.getByText(t("kart.olculmedi"))).toBeInTheDocument(); // başka kart varsayılandan farklı
    rerender(<RuleCard card={card("ornek_faiz")} registry={reg} value={0.3} draft={{ ornek_faiz: 0.3 }} durationWeeks={100} state="active" onChange={() => {}} />);
    expect(screen.getByText("6 başlangıç dünyasında ölçüldü.")).toBeInTheDocument();
  });

  it("ruleCard_passive_disabled_with_reason", () => {
    render(<Host id="ornek_pasif" state="passive" />);
    const group = screen.getByRole("group");
    for (const b of within(group).getAllByRole("button")) expect(b).toBeDisabled();
    expect(screen.getAllByText(t("rozet.passive"))).toHaveLength(1); // başlıkta rozet; kilit paragrafı ayrı metindir
    expect(group).toHaveAccessibleDescription(t("kart.pasif_kilit"));
  });

  it("ruleCard_passive_distinct_for_every_kind", () => {
    for (const id of ["ornek_pasif", "ornek_faiz", "ornek_tahvil", "ornek_sira"]) {
      const { unmount } = render(<Host id={id} state="passive" over={{ apply: "live" }} />);
      expect(screen.getByText(t("rozet.passive"))).toBeInTheDocument();
      expect(screen.getAllByText(new RegExp(t("kart.pasif_kilit"))).length).toBeGreaterThan(0);
      unmount();
    }
    // kilitli / doğrulanmadı / kayıt yok kartlarında pasif rozet ve pasif metin yoktur
    for (const reason of ["locked", "unverified", "no_recording"] as const) {
      const { unmount } = render(<Host id="ornek_faiz" state="locked" lockReason={reason} />);
      expect(screen.queryByText(t("rozet.passive"))).toBeNull();
      expect(screen.queryByText(new RegExp(t("kart.pasif_kilit")))).toBeNull();
      unmount();
    }
  });

  it("alanlar_lock_text_not_repeated_in_subfields", () => {
    render(<Host id="ornek_tahvil" state="locked" lockReason="start_only" />);
    const n = (document.body.textContent ?? "").split(t("lock.yeni_kosu")).length - 1;
    expect(n).toBe(1); // yalnız kartın kilit paragrafı
  });

  it("ruleCard_locked_reason_linked", () => {
    render(<Host id="ornek_acik" state="locked" lockReason="start_only" />);
    const group = screen.getByRole("group");
    for (const b of within(group).getAllByRole("button")) expect(b).toBeDisabled();
    expect(group).toHaveAccessibleDescription(t("lock.yeni_kosu"));
  });

  it("locked_focusable_heading_described_by_lock_reason", () => {
    const { unmount } = render(<Host id="ornek_acik" state="locked" lockReason="start_only" />);
    expect(screen.getByRole("heading", { name: "Örnek anahtar" })).toHaveAccessibleDescription(t("lock.yeni_kosu"));
    unmount();
    render(<Host id="ucret_stopaji" state="locked" lockReason="no_recording" />);
    expect(screen.getByRole("heading", { name: "Ücret stopajı" })).toHaveAccessibleDescription(new RegExp(t("kart.kayit_yok")));
  });

  it("ruleCard_lock_reason_texts", () => {
    const cases: [NonNullable<RuleCardProps["lockReason"]>, string][] = [
      ["no_recording", t("kart.kayit_yok")], ["unverified", t("kart.dogrulanmadi")], ["locked", t("lock.yeni_kosu")], ["start_only", t("lock.yeni_kosu")],
    ];
    for (const [reason, text] of cases) {
      const { unmount } = render(<Host id="ornek_acik" state="locked" lockReason={reason} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      if (reason !== "no_recording") expect(screen.queryByText(t("kart.kayit_yok"))).toBeNull(); // M3: her neden "kayıt yok" değil
      unmount();
    }
  });

  it("ruleCard_unknown_apply_locked_everywhere", () => {
    render(<Host id="ornek_akce" state="active" />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByText(new RegExp(t("kart.dogrulanmadi")))).toBeInTheDocument();
  });

  it("ruleCard_warning_band_and_badges", () => {
    render(<Host id="ornek_tahvil" />);
    expect(screen.getByText("Deneysel kart.")).toBeInTheDocument();
    expect(screen.getByText(t("rozet.experimental"))).toBeInTheDocument();
    expect(screen.getByText(t("kart.uzman"))).toBeInTheDocument();
  });

  it("ruleCard_options_toggle_emits_value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host id="gecis_destegi" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "kapalı" }));
    expect(onChange).toHaveBeenCalledWith("kapali");
    expect(screen.getByRole("button", { name: "kapalı" })).toHaveAttribute("aria-pressed", "true");
  });

  it("ruleCard_toggle_card_boolean_values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host id="ornek_acik" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "kapalı" })).toHaveAttribute("aria-pressed", "true"); // varsayılan false
    await user.click(screen.getByRole("button", { name: "açık" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("new_card_in_registry_renders_without_code_change", () => {
    const extra: RegistryCard = {
      ...card("ornek_faiz"), id: "yepyeni_kart", title: "Yepyeni kart", what: "Yeni ne.", changes: "Yeni etki.", hint: undefined, measured_values: null, apply: "live",
    };
    render(<RuleCard card={extra} registry={{ ...reg, cards: [...reg.cards, extra] }} value={0.5} draft={{}} durationWeeks={100} state="active" onChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Yepyeni kart" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByText(t("kart.olculmedi"))).toBeInTheDocument();
  });
});

describe("SayiGirdisi", () => {
  it("sayi_rejects_out_of_range_and_step_with_message", async () => {
    const onChange = vi.fn();
    // Gerçek kartın sınırları değişebilir: aralık ve adım burada sabitlenir.
    const control = { type: "number" as const, min: 0, max: 100, step: 0.5, unit: "yuzde", integer: false };
    render(<Host id="ucret_stopaji" over={{ control }} onChange={onChange} state="active" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "150" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("kart.aralik", { min: "0", max: "100" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "5.3" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("kart.adim", { min: "0", adim: "0,5" }));
    expect(t("kart.adim", { min: "0", adim: "0,5" })).not.toMatch(/ile başlar/);
    fireEvent.change(input, { target: { value: "5.5" } });
    expect(onChange).toHaveBeenLastCalledWith(5.5);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sayi_integer_and_empty_rejected", async () => {
    const onChange = vi.fn();
    render(<Host id="ornek_akce" over={{ apply: "live" }} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("kart.sayi_gecersiz"));
    fireEvent.change(input, { target: { value: "2500.5" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(t("kart.tamsayi"));
    fireEvent.change(input, { target: { value: "2500" } });
    expect(onChange).toHaveBeenLastCalledWith(2500);
  });

  it("sayi_accepts_decimal_comma_and_shows_it", () => {
    const onChange = vi.fn();
    render(<Host id="ornek_faiz" init={0.3} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("0,3");
    fireEvent.change(input, { target: { value: "0,5" } });
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { value: "0.7" } });
    expect(onChange).toHaveBeenLastCalledWith(0.7);
    onChange.mockClear();
    for (const bad of ["0,,5", "0,5,1", "abc", "1e2"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(screen.getByRole("alert")).toHaveTextContent(t("kart.sayi_gecersiz"));
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sayi_arrow_keeps_comma_display", () => {
    render(<Host id="ucret_stopaji" init={7.5} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("8");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveValue("8,5");
  });

  it("sayi_keyboard_arrow_steps", () => {
    const onChange = vi.fn();
    render(<Host id="ucret_stopaji" onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(10.5);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(9.5);
  });

  it("sayi_shows_formatted_reading_with_unit_suffix", () => {
    render(<Host id="ucret_stopaji" init={7.5} />);
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription(new RegExp(`${t("kart.okunus", { deger: "%7,5" })}`));
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  it("sayi_locked_reason_in_hint", () => {
    render(<Host id="ucret_stopaji" state="locked" lockReason="start_only" />);
    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
    expect(input).toHaveAccessibleDescription(new RegExp(t("lock.yeni_kosu")));
  });
});

describe("AlanlarKarti", () => {
  it("alanlar_partial_change_sends_full_object", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host id="ornek_tahvil" over={{ apply: "live" }} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Örnek tahvil" }).tagName).toBe("FIELDSET");
    const vade = screen.getByLabelText("Vade");
    fireEvent.change(vade, { target: { value: "52" } });
    expect(onChange).toHaveBeenLastCalledWith({ acik: true, vade: 52, tavan: 104 });
    await user.click(screen.getAllByRole("button", { name: "kapalı" })[0]!);
    expect(onChange).toHaveBeenLastCalledWith({ acik: false, vade: 52, tavan: 104 });
  });

  it("alanlar_missing_subfield_filled_with_default", async () => {
    const onChange = vi.fn();
    render(<Host id="ornek_tahvil" init={{ acik: false }} over={{ apply: "live" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Vade"), { target: { value: "52" } });
    expect(onChange).toHaveBeenLastCalledWith({ acik: false, vade: 52, tavan: 104 });
    onChange.mockClear();
    render(<Host id="ornek_tahvil" init={{}} over={{ apply: "live" }} onChange={onChange} />);
    await userEvent.setup().click(screen.getAllByRole("button", { name: "kapalı" }).at(-1)!);
    expect(onChange).toHaveBeenLastCalledWith({ acik: false, vade: 104, tavan: 104 });
  });

  it("alanlar_locked_disables_all_subfields", () => {
    render(<Host id="ornek_tahvil" />);
    expect(screen.getByLabelText("Vade")).toBeDisabled();
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });
});

describe("SiraKarti", () => {
  it("sira_move_up_down_keeps_focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host id="ornek_sira" onChange={onChange} />);
    const items = () => screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d+\./, "").replace(/[▲▼]/g, "").trim());
    expect(items()).toEqual(["Kuruluş", "Genç", "Dayanma"]);
    expect(screen.getByRole("button", { name: t("kart.yukari", { ad: "Kuruluş" }) })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("kart.asagi", { ad: "Dayanma" }) })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: t("kart.yukari", { ad: "Genç" }) }));
    expect(onChange).toHaveBeenLastCalledWith(["genc", "kurulus", "dayanma"]);
    expect(items()).toEqual(["Genç", "Kuruluş", "Dayanma"]);
    expect(screen.getByRole("button", { name: t("kart.asagi", { ad: "Genç" }) })).toHaveFocus(); // yukarı sınırda: aynı öğenin öbür düğmesi
    await user.click(screen.getByRole("button", { name: t("kart.asagi", { ad: "Genç" }) }));
    expect(items()).toEqual(["Kuruluş", "Genç", "Dayanma"]);
    expect(screen.getByRole("button", { name: t("kart.asagi", { ad: "Genç" }) })).toHaveFocus();
  });

  it("sira_locked_disables_buttons", () => {
    render(<Host id="ornek_sira" state="locked" lockReason="start_only" />);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });
});

describe("CokluSecim", () => {
  it("coklu_toggle_emits_items_in_card_order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host id="ornek_sektorler" onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Tarım" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Hizmet" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Hizmet" }));
    expect(onChange).toHaveBeenLastCalledWith(["tarim", "sanayi", "hizmet"]);
    await user.click(screen.getByRole("checkbox", { name: "Tarım" }));
    expect(onChange).toHaveBeenLastCalledWith(["sanayi", "hizmet"]);
  });

  it("coklu_locked_disables_checkboxes", () => {
    render(<Host id="ornek_sektorler" state="locked" lockReason="no_recording" />);
    for (const c of screen.getAllByRole("checkbox")) expect(c).toBeDisabled();
    expect(screen.getByRole("group", { name: "Örnek sektörler" })).toHaveAccessibleDescription(t("kart.kayit_yok"));
  });

  it("w4_shows_rows_read_only_with_units", () => {
    render(<Host id="ornek_faiz" />);
    expect(screen.getByText(/En az yaş/)).toBeInTheDocument();
    expect(screen.getByText(/52 hafta/)).toBeInTheDocument();
  });

  it("w4_info_card_has_no_control_no_lock_not_passive", () => {
    const { container } = render(<Host id="ornek_salt_okunur" state="active" />);
    for (const x of ["Limit çarpanı", "En az yaş", "Ağırlık", "Anahtar"]) expect(screen.getByText(new RegExp(x))).toBeInTheDocument();
    expect(screen.getByText("12 kat")).toBeInTheDocument();
    expect(screen.getByText(t("sart.salt_okunur"))).toBeInTheDocument();
    expect(container.querySelector("button, input, [role=group], [role=radiogroup]")).toBeNull();
    expect(screen.queryByText(t("rozet.passive"))).toBeNull();
    expect(screen.queryByText(t("kart.dogrulanmadi"))).toBeNull();
  });

  it("w4_info_card_with_unknown_apply_still_not_locked", () => {
    render(<Host id="ornek_salt_okunur" over={{ apply: "unknown" }} />);
    expect(screen.queryByText(t("kart.dogrulanmadi"))).toBeNull();
    expect(screen.getByText(t("sart.salt_okunur"))).toBeInTheDocument();
  });

  it("w4_fixed_lock_reason_text", () => {
    render(<Host id="ornek_acik" state="locked" lockReason="fixed" />);
    expect(screen.getByText(t("sart.kilit_sabit"))).toBeInTheDocument();
  });
});
