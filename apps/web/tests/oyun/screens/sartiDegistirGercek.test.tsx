import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { useRestoreRun } from "@/oyun/hooks/useRestoreRun";
import { degistirKapat } from "@/oyun/screens/canli/degistirDurumu";
import { Canli } from "@/oyun/screens/canli/Canli";
import { isKural, kartDurumu } from "@/oyun/screens/sart/sartMantik";
import { parseRegistry } from "@/oyun/sim/live/wire";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Registry, RegistryCard, RunState, SimEvent, SourceInfo, WeekPacket, World } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";

/**
 * E1 Step 0: yayımlanan gerçek kayıtla (`public/oyun-kayit/registry.json`, sunucunun `public()` çıktısıyla aynı; `yayinla.py --check` denetler)
 * W8 "Şartı değiştir" sınıflaması. Sentetik kayıt değil: R2 sınıf sayıları değişse de ilke aynı kalır.
 */
const registry = (): Registry => parseRegistry(JSON.parse(readFileSync(path.resolve(process.cwd(), "public/oyun-kayit/registry.json"), "utf8")));
const duzenlenebilir = (r: Registry): RegistryCard[] => r.cards.filter((c) => isKural(c) && c.editable && c.status === "active");

describe("gerçek kayıt: uygulama sınıfı ve Şartı değiştir kilidi", () => {
  it("duzenlenebilir_kuralda_unknown_kalmamis", () => {
    const r = registry();
    expect(duzenlenebilir(r).length).toBeGreaterThan(0);
    expect(duzenlenebilir(r).filter((c) => c.apply === "unknown").map((c) => c.id)).toEqual([]);
    // unknown yalnız düzenlenemeyen (salt okunur ya da pasif) kartlarda kalabilir
    expect(r.cards.filter((c) => c.apply === "unknown" && c.editable).map((c) => c.id)).toEqual([]);
  });

  it("her_live_kart_canli_kipte_acik_her_start_only_kart_kilitli_ve_nedenli", () => {
    const r = registry();
    const live = duzenlenebilir(r).filter((c) => c.apply === "live" || c.apply === "live_sync");
    const kilitli = duzenlenebilir(r).filter((c) => c.apply === "start_only");
    expect(live.length).toBeGreaterThanOrEqual(5);
    expect(kilitli.length).toBeGreaterThan(0);
    for (const c of live) expect(kartDurumu(c, "live"), c.id).toEqual({ state: "active" });
    for (const c of kilitli) {
      expect(kartDurumu(c, "live"), c.id).toEqual({ state: "locked", lockReason: "start_only" });
      expect(kartDurumu(c, "builder"), c.id).toEqual({ state: "active" }); // Kurucu'da her start_only kart açık
    }
  });
});

const NULL_WORLD = Object.fromEntries(
  ["served", "unemployed", "employed", "npc_firms", "player_firms", "failed_cum", "city_cash_total", "city_cash_weeks", "gini", "price_index", "inflation_yoy", "unemployment_rate", "policy_rate", "minted_year", "mint_cap", "loans_applied", "loans_rejected", "loans_granted", "loan_rate_avg", "support_weekly", "survival_52", "wage_index", "rent_pct", "occupancy", "house_index", "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg", "money_total", "velocity", "privatized_firms", "no_founder", "reject_pool", "reject_reputation", "no_buyer_cum"].map((k) => [k, null]),
) as World;
const wk = (week: number): SimEvent => ({ type: "week", packet: { v: 1, run_id: "r", week, version: 1, world: { ...NULL_WORLD, served: 0.9, unemployment_rate: 0.1 }, events: [] } as WeekPacket });
const st = (): SimEvent => ({
  type: "state",
  state: { runId: "r", status: "paused", week: 5, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "kapali", name: "Ada", cityNames: [], } as RunState,
});
function Ekran() {
  const { route } = useHashRoute();
  const { status } = useRestoreRun(route.name === "canli" ? route.runId : null);
  return route.name === "canli" ? <Canli runId={route.runId} restore={{ status }} /> : null;
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.location.hash = "";
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  degistirKapat();
  const calls = errSpy.mock.calls.map((c: unknown[]) => String(c[0]).slice(0, 300));
  cleanup();
  errSpy.mockRestore();
  expect(calls).toEqual([]);
});

const kartBul = (title: string) => screen.getByRole("article", { name: title });
async function ara(dlg: HTMLElement, c: RegistryCard): Promise<void> {
  fireEvent.change(within(dlg).getByRole("searchbox", { name: t("sart.ara") }), { target: { value: c.title } });
  const liste = within(dlg).getByRole("list", { name: t("sart.ara_sonuclar") });
  fireEvent.click(within(liste).getAllByRole("button").find((b) => within(b).queryByText(c.title))!);
}

describe("gerçek kayıt: Şartı değiştir panelinde", () => {
  it("live_kart_acik_start_only_kart_kilitli_ve_yeni_koşu_önerilir", async () => {
    const r = registry();
    const src = createFakeSource([st(), wk(5)], { kind: "live" });
    const info = await src.info();
    vi.spyOn(src, "info").mockResolvedValue({ ...info, registry: r, settings: [] } as SourceInfo);
    window.location.hash = "#/canli/r";
    render(
      <SimSourceProvider source={src}>
        <Ekran />
      </SimSourceProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/^Hafta \d+ \/ 200$/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: t("degistir.dugme") }));
    const dlg = await screen.findByRole("dialog");
    await within(dlg).findByRole("searchbox", { name: t("sart.ara") });

    const d = duzenlenebilir(r).filter((c) => c.kind === "number" && !c.title.includes(","));
    const live = d.find((c) => c.apply === "live")!;
    const kilitli = d.find((c) => c.apply === "start_only")!;
    await ara(dlg, live);
    await waitFor(() => expect(within(kartBul(live.title)).getByRole("textbox")).toBeEnabled());
    await ara(dlg, kilitli);
    const kk = kartBul(kilitli.title);
    expect(within(kk).getByRole("textbox")).toBeDisabled();
    expect(within(kk).getByRole("textbox")).toHaveAccessibleDescription(new RegExp(t("lock.yeni_kosu")));
    // kilitli kart varken "Yeni koşu olarak başlat" önerilir
    expect(within(dlg).getByText(t("sart.degistir.yeni_kosu_bilgi"))).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: t("sart.degistir.yeni_kosu") })).toBeEnabled();
    await act(async () => {});
  }, 30000);
});
