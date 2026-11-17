import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { Canli } from "@/oyun/screens/canli/Canli";
import { degistirKapat } from "@/oyun/screens/canli/degistirDurumu";
import { KilitliKart } from "@/oyun/screens/ortak/KilitliKart";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunState, SimEvent, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";
import { ayrintilariAc, ayrintilariKapat } from "../helpers/canliMount";
import { createFakeSource, type FakeSource } from "../helpers/fakeSource";

const NULL_WORLD = Object.fromEntries(
  ["served", "unemployed", "employed", "npc_firms", "player_firms", "failed_cum", "city_cash_total", "city_cash_weeks", "gini", "price_index", "inflation_yoy", "unemployment_rate", "policy_rate", "minted_year", "mint_cap", "loans_applied", "loans_rejected", "loans_granted", "loan_rate_avg", "support_weekly", "survival_52", "wage_index", "rent_pct", "occupancy", "house_index", "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg", "money_total", "velocity", "privatized_firms", "no_founder", "reject_pool", "reject_reputation", "no_buyer_cum"].map((k) => [k, null]),
) as World;
const wk = (week: number): SimEvent => ({
  type: "week",
  packet: { v: 1, run_id: "r", week, version: 1, world: { ...NULL_WORLD, served: 0.9, unemployment_rate: 0.1 }, events: [] } as WeekPacket,
});
const st = (over: Partial<RunState> = {}): SimEvent => ({
  type: "state",
  state: { runId: "r", status: "paused", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: { gecis_destegi: "kapali" }, scenarioId: "kapali", name: "Ada", cityNames: [], ...over },
});
const verEv = (seam: number): SimEvent => ({
  type: "world_event",
  event: { id: `version:2:${seam}`, week: seam, kind: "neutral", textKey: "event.version", params: { hafta: seam, mod: "live", surum: 2 }, critical: false, sector: null, rule_ids: [], } as WorldEvent,
});

function mountCanli(script: SimEvent[], kind: "replay" | "live") {
  const src = createFakeSource(script, { kind });
  const view = render(
    <SimSourceProvider source={src}>
      <Canli runId="r" restore={{ status: "ready" }} />
    </SimSourceProvider>,
  );
  return { src, view };
}
const emit = (src: FakeSource, ...es: SimEvent[]): void => {
  act(() => es.forEach((e) => src.emit("r", e)));
};
const KAYITLI = /kayıttan oynat|kayıtlı senaryo|kayıtlı model|kayıtlıdır|bu kayıtta|bu kayıtlarda|kayıtlarda sabit|en yakın kayıtlı|kayıtlarda yok/i;

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  degistirKapat();
  cleanup();
});

describe("Canlı: kaynağa göre metin", () => {
  it("test_live_wording_by_kind_canli", async () => {
    const { src } = mountCanli([st({ week: 5 }), wk(5)], "live");
    await screen.findByText(t("canli.kaynak.live"));
    expect(screen.queryByText(t("canli.kaynak.replay"))).toBeNull();
    emit(src, st({ week: 5, computing: true }));
    expect(screen.getByText(t("degistir.hesaplaniyor.live"))).toBeInTheDocument();
    emit(src, st({ week: 5, computing: false, version: 2 }), verEv(7));
    expect(screen.getByText(t("degistir.dikis_live", { n: 7 }))).toBeInTheDocument();
    expect(screen.queryByText(t("degistir.dikis_nearest", { n: 7 }))).toBeNull();
    expect(screen.queryByText(t("degistir.dikis_exact", { n: 7 }))).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(KAYITLI);
  });

  it("test_live_wording_by_kind_replay_degismedi", async () => {
    const { src } = mountCanli([st({ week: 5 }), wk(5)], "replay");
    await screen.findByText(t("canli.kaynak.replay"));
    expect(t("canli.kaynak.replay")).toBe("kayıttan oynatılıyor");
    emit(src, st({ week: 5, computing: true }));
    expect(screen.getByText(t("degistir.hesaplaniyor.replay"))).toBeInTheDocument();
    expect(t("degistir.hesaplaniyor.replay")).toBe(t("degistir.hesaplaniyor"));
  });

  it("test_buffering_note_visible_only_when_buffering", async () => {
    const { src } = mountCanli([st({ week: 5, status: "running" }), wk(5)], "live");
    await screen.findByText(t("canli.kaynak.live"));
    expect(screen.queryByText(t("canli.hiz_siniri"))).toBeNull();
    emit(src, st({ week: 5, status: "running", buffering: true, modelWeeksPerSec: 0.5 }));
    expect(screen.getByText(t("canli.hiz_siniri"))).toBeVisible();
    expect(screen.getByText(t("canli.hiz_olcu", { n: "0,5" }))).toBeVisible();
    emit(src, st({ week: 6, status: "running", buffering: false, modelWeeksPerSec: 0.5 }));
    expect(screen.queryByText(t("canli.hiz_siniri"))).toBeNull();
    expect(screen.queryByText(/saniyede/)).toBeNull();
  });

  it("model_hazirlanirken_hafta_0_notu_model_hizi_demez", async () => {
    mountCanli([st({ week: 0, status: "paused", buffering: true })], "live");
    expect(await screen.findByText(t("canli.model_hazirlaniyor"))).toBeVisible();
    expect(screen.queryByText(t("canli.hiz_siniri"))).toBeNull();
    expect(t("canli.model_hazirlaniyor")).toBe("Model hazırlanıyor: ilk hafta hesaplanıyor");
  });

  it("kosu_bulunamadi_hatasi_kosu_yok_ekranini_ve_yeni_kosu_eylemini_gosterir", async () => {
    const { src } = mountCanli([st({ week: 3, status: "running" }), wk(1), wk(2), wk(3)], "live");
    await screen.findByText(t("canli.kaynak.live"));
    emit(src, { type: "error", messageKey: "hata.kosu_bulunamadi" });
    expect(screen.getByText(t("canli.kosu_yok"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: t("canli.yeni_kosu") }));
    expect(window.location.hash).toBe("#/kurucu");
  });

  it("kayit_kaynagi_buffering_notu_asla_gostermez", async () => {
    const { src } = mountCanli([st({ week: 5, status: "running" }), wk(5)], "replay");
    await screen.findByText(t("canli.kaynak.replay"));
    emit(src, st({ week: 5, status: "running", buffering: true }));
    expect(screen.queryByText(t("canli.hiz_siniri"))).toBeNull();
  });

  it("test_failed_state_shows_model_crash_message_and_keeps_chart", async () => {
    const { src } = mountCanli([st({ week: 3, status: "running" }), wk(1), wk(2), wk(3)], "live");
    await ayrintilariAc("Genel");
    // Grafik ikinci seriyi (işsiz oranı) gösterge satırıyla çizene dek bekle: ölçüm kararlı bir kareden alınır (throttle sonrası).
    await waitFor(() => expect(document.querySelector('[data-seri="unemployment"]')).toBeInTheDocument());
    const before = document.querySelectorAll("svg").length;
    expect(before).toBeGreaterThan(0);
    emit(src, st({ week: 3, status: "failed", error: { messageKey: "hata.model_coktu", week: 3 } }));
    expect(screen.getByRole("heading", { name: t("canli.gostergeler") })).toBeVisible();
    expect(document.querySelectorAll("svg").length).toBe(before); // önceki haftalar grafikte aynen kalır
    // Kabuktaki hata bandı Ayrıntılar açıkken çizilmez (aynı bant Koşu sekmesindedir); pencere kapanınca görünür.
    expect(screen.queryByText(t("hata.model_coktu"))).toBeNull();
    ayrintilariKapat();
    expect(screen.getByText(t("hata.model_coktu"))).toBeVisible();
    // Canlı koşuda "Yeniden dene" ölü düğme olurdu (aynı failed durumu döner): net eylem "Yeni koşu kur".
    expect(screen.queryByRole("button", { name: t("durum.yeniden") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("canli.yeni_kosu") }));
    expect(window.location.hash).toBe("#/kurucu");
    // Koşu durmuş: saat çubuğu oynatma komutları kapalı, "Şartı değiştir" yok.
    expect(screen.queryByRole("button", { name: t("degistir.dugme") })).toBeNull();
  });

  it("failed_ve_hic_hafta_yoksa_yalniz_hata", async () => {
    mountCanli([st({ status: "failed", error: { messageKey: "hata.model_coktu", week: 0 } })], "live");
    expect(await screen.findByText(t("hata.model_coktu"))).toBeVisible();
  });
});

describe("Kurucu: kaynağa göre metin", () => {
  /** W4: kayıt (`registry`) varken sabit kurallar Şart editörüne taşındı; `fixedRules` kartları yalnız kayıt yokken (geri dönüş yolu) çizilir, bu yüzden bu denemeler kaydı çıkarır. */
  function mountKurucu(kind: "replay" | "live", fixedRules: { settingId: string; valueKey: never; valueText?: string }[] = [], withRegistry = false) {
    const base = createFakeSource([], { kind });
    const src = {
      ...base,
      info: async () => {
        const { registry, ...rest } = await base.info();
        return { ...rest, kind, fixedRules, ...(withRegistry && registry ? { registry } : {}) };
      },
    };
    return render(
      <SimSourceProvider source={src}>
        <Kurucu adopt={() => {}} />
      </SimSourceProvider>,
    );
  }

  it("kayit_notu_kaynaga_gore", async () => {
    mountKurucu("live");
    expect(await screen.findByText(t("kurucu.kayit_notu.live"))).toBeVisible();
    expect(screen.queryByText(t("kurucu.kayit_notu.replay"))).toBeNull();
    cleanup();
    mountKurucu("replay");
    expect(await screen.findByText(t("kurucu.kayit_notu.replay"))).toBeVisible();
    expect(t("kurucu.kayit_notu.replay")).toBe(t("kurucu.kayit_notu"));
  });

  it("canlida_kayit_dili_yok", async () => {
    mountKurucu("live", [{ settingId: "ucret_stopaji", valueKey: "lock.canli" as never, valueText: "%25" }]);
    await screen.findByText(t("kurucu.kayit_notu.live"));
    for (const ad of [null, t("kurucu.adim1.ad"), t("kurucu.adim2.ad"), t("kurucu.adim3.ad"), t("kurucu.adim4.ad")]) {
      if (ad !== null) fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(ad) }));
      const main = document.body.textContent ?? "";
      expect(main).not.toMatch(KAYITLI);
      expect(main).not.toMatch(/Eski ölçüm notu/);
    }
    expect(await screen.findByText("%25")).toBeVisible(); // sabit kurallar Özet adımında
  });

  it("canlida_kayit_dili_yok_sart_editorunde", async () => {
    mountKurucu("live", [], true);
    await screen.findByText(t("kurucu.kayit_notu.live"));
    fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t("kurucu.adim2.ad")) }));
    await screen.findByRole("region", { name: t("sart.editor") });
    const main = document.body.textContent ?? "";
    expect(main).not.toMatch(KAYITLI);
    expect(main).not.toMatch(/Eski ölçüm notu/);
  });

  it("test_valueText_gosterilir_yoksa_valueKey", async () => {
    mountKurucu("live", [
      { settingId: "ucret_stopaji", valueKey: "lock.deger.ucret_stopaji" as never, valueText: "%25" },
      { settingId: "kurumlar_vergisi", valueKey: "lock.deger.kurumlar_vergisi" as never },
    ]);
    await screen.findByText(t("kurucu.kayit_notu.live"));
    fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t("kurucu.adim4.ad")) }));
    expect(await screen.findByRole("button", { name: "%25" })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("lock.deger.kurumlar_vergisi") })).toBeDisabled();
    expect(screen.queryByRole("button", { name: t("lock.deger.ucret_stopaji") })).toBeNull();
  });
});

describe("KilitliKart", () => {
  it("valueText_oncelikli_ve_kilit_nedeni_kaynaga_gore", () => {
    const src = createFakeSource([], { kind: "live" });
    render(
      <SimSourceProvider source={src}>
        <KilitliKart settingId="ucret_stopaji" valueKey="lock.deger.ucret_stopaji" valueText="%25" />
      </SimSourceProvider>,
    );
    const card = screen.getByRole("article");
    expect(within(card).getByRole("button", { name: "%25" })).toBeDisabled();
    expect(within(card).getByText(t("lock.sabit.live"))).toBeVisible();
    expect(card.textContent ?? "").not.toMatch(KAYITLI);
  });
});

describe("Şartı değiştir: canlı", () => {
  it("uygula_dugmesi_gelecek_haftayi_vaat_etmez", async () => {
    mountCanli([st({ week: 5 }), wk(5)], "live");
    fireEvent.click(await screen.findByRole("button", { name: t("degistir.dugme") }));
    expect(await screen.findByRole("button", { name: t("degistir.uygula_live", { n: 6 }) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("degistir.uygula", { n: 6 }) })).toBeNull();
  });
});
