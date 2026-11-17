import { describe, expect, it } from "vitest";
import {
  WireError, parseCapabilities, parseChange, parseDiagnostic, parseEvent, parseEventOrNull, parseInfo, parsePacket, parseRegistry, parseState,
} from "@/oyun/sim/live/wire";
import { packetOf } from "../../helpers/fakeLiveServer";
import { contractRegistryRaw } from "../../helpers/registryFixtures";

const DRAFT = contractRegistryRaw();

const state = {
  runId: "r", status: "paused", week: 4, durationWeeks: 200, speed: 1, computing: false, version: 2, seedIndex: 0, values: { a: "x" },
  scenarioId: "canli", name: "Ada", cityNames: ["a", "b", "c", "d", "e"],
};
const event = {
  id: "version:2:4:a", week: 4, kind: "neutral", textKey: "event.version", params: { hafta: 4, mod: "live", surum: 2 },
  critical: false, sector: null, rule_ids: ["a"],
};

describe("wire v2 (DK-15 tolerans)", () => {
  it("parse_state_accepts_preparing_versions_world_scenario", () => {
    const s = parseState({
      ...state, preparing: { done: 3, total: 10 }, worldScenarioId: "ozel", goals: ["alive", "gini"], parentRunId: "p", forkWeek: 12,
      versions: [{ version: 1, fromWeek: 0, values: { a: "x" } }, { version: 2, fromWeek: 4, values: { a: "y", f: { x: 1 }, l: ["p", "q"] }, note: "n" }],
    });
    expect(s).toMatchObject({
      preparing: { done: 3, total: 10 }, worldScenarioId: "ozel", goals: ["alive", "gini"], parentRunId: "p", forkWeek: 12, scenarioId: "canli",
    });
    expect(s.versions).toEqual([{ version: 1, fromWeek: 0, values: { a: "x" } }, { version: 2, fromWeek: 4, values: { a: "y", f: { x: 1 }, l: ["p", "q"] }, note: "n" }]);
    expect(parseState({ ...state, preparing: null, versions: null, worldScenarioId: null })).toEqual(state);
    expect(() => parseState({ ...state, preparing: { done: "3", total: 10 } })).toThrow(WireError);
    expect(() => parseState({ ...state, goals: ["alive", "yok"] })).toThrow(WireError);
  });

  it("parse_event_changes_and_chain", () => {
    const ev = parseEvent({
      ...event, changes: [{ id: "a", from: "x", to: "y" }, { id: "b", from: null, to: { vade: 52 } }],
      chain: [{ step: "kural", textKey: "event.version", params: { n: 1, s: "t" } }],
    });
    expect(ev.changes).toEqual([{ id: "a", from: "x", to: "y" }, { id: "b", from: null, to: { vade: 52 } }]);
    expect(ev.chain).toEqual([{ step: "kural", textKey: "event.version", params: { n: 1, s: "t" } }]);
    expect(parseEvent({ ...event, changes: null, chain: null })).toEqual(event);
    expect(() => parseEvent({ ...event, changes: [{ id: "a", to: "y" }] })).toThrow(WireError);
  });

  it("parse_change_result_start_only_reason", () => {
    expect(parseChange({ accepted: false, fields: [{ id: "a", reason: "start_only" }, { id: "b", reason: "passive" }] })).toEqual({
      accepted: false, fields: [{ id: "a", reason: "start_only" }, { id: "b", reason: "passive" }],
    });
  });

  it("unknown_reason_maps_to_invalid", () => {
    expect(parseChange({ error: { fields: [{ id: "b", reason: "tuhaf" }, { id: "c" }] } })).toEqual({
      accepted: false, fields: [{ id: "b", reason: "invalid" }, { id: "c", reason: "invalid" }],
    });
  });

  it("unknown_top_level_fields_ignored", () => {
    expect(parseState({ ...state, yeni: 1, baska: { x: 1 } })).toEqual(state);
    const p = packetOf("r", 2, 1);
    expect(parsePacket({ ...p, yeni_alan: [1], world: { ...p.world, yeni_gosterge: 5 } })).toEqual(p);
    expect(parseEvent({ ...event, ek: true })).toEqual(event);
    expect(parseChange({ accepted: true, runId: "r", mode: "live", scenarioId: "s", seamWeek: 1, version: 2, ek: 1 })).toMatchObject({ accepted: true });
    const info = parseInfo({
      kind: "live", modelNote: "m", seeds: [], durationWeeks: 200, settings: [], fixedRules: [], templates: [], ek: 1, durations: [100, 200, 500],
    });
    expect(info.durations).toEqual([100, 200, 500]);
  });

  it("diagnostic_with_unknown_textkey_dropped", () => {
    const good = { id: "d1", textKey: "neolmuyor.faiz_dusmuyor", params: { n: 13 }, rule_ids: ["faiz"], since_week: 20 };
    expect(parseDiagnostic(good)).toEqual(good);
    expect(parseDiagnostic({ ...good, textKey: "neolmuyor.yok_boyle_bir_sey" })).toBeNull();
    expect(() => parseDiagnostic({ ...good, since_week: "x" })).toThrow(WireError);
    const p = packetOf("r", 2, 1);
    const out = parsePacket({ ...p, diagnostics: [good, { ...good, id: "d2", textKey: "neolmuyor.yeni_kural" }, { ...good, id: "d3", textKey: "neolmuyor.destek_yok" }] });
    expect(out.diagnostics?.map((d) => d.id)).toEqual(["d1", "d3"]);
  });

  it("unknown_textkey_event_dropped_not_error", () => {
    expect(parseEventOrNull({ ...event, textKey: "event.henuz_yok" })).toBeNull();
    expect(parseEventOrNull(event)).toEqual(event);
    expect(() => parseEventOrNull({ ...event, week: "x" })).toThrow(WireError);
    const p = packetOf("r", 2, 1);
    const out = parsePacket({ ...p, events: [event, { ...event, id: "x", textKey: "event.henuz_yok" }] });
    expect(out.events.map((e) => e.id)).toEqual([event.id]);
    // zincir adımında bilinmeyen anahtar: yalnız o adım düşer
    const ev = parseEvent({ ...event, chain: [{ step: "a", textKey: "event.henuz_yok", params: {} }, { step: "b", textKey: "event.version", params: {} }] });
    expect(ev.chain?.map((c) => c.step)).toEqual(["b"]);
  });

  it("parse_packet_optional_diagnostics_null_safe", () => {
    const p = packetOf("r", 2, 1);
    expect(parsePacket(p).diagnostics).toBeUndefined();
    expect(parsePacket({ ...p, diagnostics: null }).diagnostics).toBeUndefined();
    expect(parsePacket({ ...p, diagnostics: [] }).diagnostics).toEqual([]);
    expect(() => parsePacket({ ...p, diagnostics: "x" })).toThrow(WireError);
  });

  it("parse_registry_from_contract_fixture", () => {
    const reg = parseRegistry(DRAFT);
    // Gerçek kayıt büyür: sabit sayı değil, bilinen kartların varlığı denetlenir.
    expect(reg.cards.map((c) => c.id)).toEqual(expect.arrayContaining([
      "gecis_destegi", "dunya_tohumu", "ucret_stopaji", "kurumlar_vergisi", "zararda_once_kucul", "ornek_tahvil", "ornek_sira", "ornek_sektorler",
      "ornek_oncelik", "ornek_faiz", "ornek_akce", "ornek_acik", "ornek_pasif",
    ]));
    expect(reg.groups.map((g) => g.id)).toEqual(expect.arrayContaining(["kurtarma", "vergi", "dunya"]));
    const orders = reg.groups.map((g) => g.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    // Göreli sıra korunur (bilinenleri süzüp karşılaştır).
    const bilinen = new Set(["gecis_destegi", "dunya_tohumu", "ucret_stopaji", "kurumlar_vergisi", "zararda_once_kucul"]);
    expect(reg.cards.map((c) => c.id).filter((id) => bilinen.has(id))).toEqual(["gecis_destegi", "dunya_tohumu", "ucret_stopaji", "kurumlar_vergisi", "zararda_once_kucul"]);
    expect(reg.templates[0]).toMatchObject({ id: "gecis_destegi", values: { gecis_destegi: "kurtarma_fonuyla" } });
    expect(reg.units).toMatchObject({ yuzde: "%{n}", acik: "açık", kapali: "kapalı" });
    const by = Object.fromEntries(reg.cards.map((c) => [c.id, c]));
    expect(by.ornek_tahvil).toMatchObject({ kind: "fields", status: "experimental", apply: "unknown", aliases: ["tahvil"], measured_weeks: 200 });
    const c = by.ornek_tahvil!.control;
    expect(c.type === "fields" && c.fields.map((f) => f.key)).toEqual(["acik", "vade", "tavan"]);
    expect(by.ornek_sira).toMatchObject({ kind: "order", apply: "start_only", credit_type: "kurulus", default: ["kurulus", "genc", "dayanma"] });
    expect(by.ornek_sektorler).toMatchObject({ measured_values: [["tarim", "sanayi"]], measured_with: { gecis_destegi: "kapali" }, measured_weeks: 500 });
    expect(by.ornek_oncelik).toMatchObject({ measured_values: [["tarim"], ["tarim", "sanayi"]], measured_with: { _sablon: "dayanikli_taban" } });
    expect(by.gecis_destegi!.basis?.label).toBeTruthy();
    expect(by.zararda_once_kucul).toMatchObject({ kind: "toggle", default: true });
    expect(by.kurumlar_vergisi).toMatchObject({ control: { type: "number", unit: "yuzde", integer: false } });
    // bozuk tür: WireError
    const bad = JSON.parse(JSON.stringify(DRAFT)) as { cards: Record<string, unknown>[] };
    bad.cards[0]!.control = { type: "bilinmeyen" };
    expect(() => parseRegistry(bad)).toThrow(WireError);
    // bilinmeyen apply güvenli tarafa (kilitli) düşer; bilinmeyen üst düzey alan yok sayılır
    const odd = JSON.parse(JSON.stringify(DRAFT)) as { cards: Record<string, unknown>[] };
    odd.cards[0]!.apply = "yeni_sinif";
    odd.cards[0]!.ek = 1;
    expect(parseRegistry({ ...odd, ek: 2 }).cards[0]!.apply).toBe("unknown");
  });

  it("parse_info_registry_changeable_reason_capabilities", () => {
    const info = parseInfo({
      kind: "live", modelNote: "m", seeds: [], durationWeeks: 200, fixedRules: [], templates: [], registry: DRAFT,
      capabilities: { branch: true, jobs: true },
      settings: [{ id: "a", changeable: false, reason: "start_only", options: [{ value: "x", available: true }] }, { id: "b", options: [] }],
    });
    expect(info.registry?.cards.length).toBeGreaterThanOrEqual(13);
    expect(info.capabilities).toMatchObject({ branch: true, jobs: true, seeds: false, rebuild: false });
    expect(info.settings[0]).toMatchObject({ changeable: false, reason: "start_only" });
    expect(info.settings[1]?.changeable).toBeUndefined();
    expect(() => parseInfo({ kind: "live", modelNote: "m", seeds: [], durationWeeks: 200, fixedRules: [], templates: [], settings: [{ id: "a", reason: "tuhaf", options: [] }] })).not.toThrow();
  });

  it("fixedRules_bilinmeyen_valueKey_valueText_varsa_kalir_yoksa_dusurulur", () => {
    const base = { kind: "live", modelNote: "m", seeds: [], durationWeeks: 200, templates: [], settings: [] };
    const info = parseInfo({
      ...base,
      fixedRules: [
        { settingId: "ucret_stopaji", valueKey: "lock.deger.ucret_stopaji" },
        { settingId: "yeni_kural", valueKey: "lock.deger.yeni_kural", valueText: "%7" },
        { settingId: "baska_kural", valueKey: "lock.deger.baska_kural" },
      ],
    });
    expect(info.fixedRules.map((r) => r.settingId)).toEqual(["ucret_stopaji", "yeni_kural"]);
    expect(info.fixedRules[1]?.valueText).toBe("%7");
    expect(() => parseInfo({ ...base, fixedRules: [{ settingId: "x", valueKey: 5 }] })).toThrow(WireError);
  });

  it("parse_capabilities_missing_means_all_false", () => {
    const none = { branch: false, seeds: false, compare: false, library: false, city: false, chain: false, jobs: false, rebuild: false, harita: false };
    expect(parseCapabilities(undefined)).toEqual(none);
    expect(parseCapabilities(null)).toEqual(none);
    expect(parseCapabilities({})).toEqual(none);
    expect(parseCapabilities({ branch: true, yeni: true, chain: "evet" })).toEqual({ ...none, branch: true });
  });

  it("m1_chain_textkey_must_be_string", () => {
    expect(() => parseEvent({ ...event, chain: [{ step: "a", textKey: 5, params: {} }] })).toThrow(WireError);
    expect(() => parseEvent({ ...event, chain: [{ step: "a", params: {} }] })).toThrow(WireError);
  });

  it("m2_option_reason_unknown_maps_to_locked", () => {
    const base = { kind: "live", modelNote: "m", seeds: [], durationWeeks: 200, fixedRules: [], templates: [] };
    const info = parseInfo({ ...base, settings: [{ id: "a", options: [{ value: "x", available: false, reason: "yeni_neden" }, { value: "y", available: false, reason: "no_recording" }] }] });
    expect(info.settings[0]?.options.map((o) => o.reason)).toEqual(["locked", "no_recording"]);
  });

  it("m4_diagnostic_only_neolmuyor_prefix", () => {
    const d = { id: "d", textKey: "event.version", params: {}, rule_ids: [], since_week: 1 };
    expect(parseDiagnostic(d)).toBeNull();
    expect(parseDiagnostic({ ...d, textKey: "neolmuyor.basim_siniri" })).not.toBeNull();
    const p = packetOf("r", 2, 1);
    expect(parsePacket({ ...p, diagnostics: [d] }).diagnostics).toEqual([]);
  });

  it("w4_card_shows_parsed_strict_unknown_ignored", () => {
    const raw = contractRegistryRaw() as { cards: Record<string, unknown>[] };
    const parsed = parseRegistry(raw);
    expect(parsed.cards.find((c) => c.id === "ornek_salt_okunur")?.shows).toEqual([
      { label: "Limit çarpanı", text: "12 kat", value: 12 }, { label: "En az yaş", text: "52 hafta", value: 52 }, { text: "%5", value: 5 },
      { label: "Ağırlık", text: "0,7", value: 0.7 }, { label: "Anahtar", text: "kapalı", value: false },
    ]);
    expect(parsed.cards.find((c) => c.id === "gecis_destegi")?.shows).toBeUndefined();
    const withShows = (shows: unknown): unknown => ({ ...raw, cards: raw.cards.map((c) => (c.id === "ornek_faiz" ? { ...c, shows } : c)) });
    const ok = parseRegistry(withShows([{ label: "A", text: "1 kat", value: 1, key: "gizli", yeni: 2 }]));
    expect(ok.cards.find((c) => c.id === "ornek_faiz")?.shows).toEqual([{ label: "A", text: "1 kat", value: 1 }]);
    expect(() => parseRegistry(withShows("x"))).toThrow(WireError);
    expect(() => parseRegistry(withShows([{ label: "A", value: 1 }]))).toThrow(WireError);
    expect(() => parseRegistry(withShows([{ text: 5, value: 1 }]))).toThrow(WireError);
    expect(() => parseRegistry(withShows([{ text: "x", value: { a: 1 } }]))).toThrow(WireError);
  });
});
