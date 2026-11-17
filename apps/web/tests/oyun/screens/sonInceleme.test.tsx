import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { useHashRoute } from "@/oyun/hooks/useHashRoute";
import { useRestoreRun } from "@/oyun/hooks/useRestoreRun";
import { Canli } from "@/oyun/screens/canli/Canli";
import { degistirKapat } from "@/oyun/screens/canli/degistirDurumu";
import { createReplaySource } from "@/oyun/sim/replay";
import { encodeRunId } from "@/oyun/sim/replay/runId";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { SimSource } from "@/oyun/sim/types";
import { ayrintilariAc, ayrintilariKapat } from "../helpers/canliMount";
import { createFakeSource } from "../helpers/fakeSource";
import { contractRegistryRaw } from "../helpers/registryFixtures";
import { degistirAcDiyalog, gecisSec } from "../helpers/degistirYardim";
import { allFiles, fakeTimer, makeFetch, type Files, type FakeTimer } from "../helpers/replayFixture";

const CITIES = ["a", "b", "c", "d", "e"];
const rid = (changes: { week: number; setId: string }[] = []) => encodeRunId({ setId: "kapali", seedIndex: 0, changes, name: "Ada Dünyası", cityNames: CITIES });

function Ekran() {
  const { route } = useHashRoute();
  const { status } = useRestoreRun(route.name === "canli" ? route.runId : null);
  return route.name === "canli" ? <Canli runId={route.runId} restore={{ status }} /> : null;
}

type Env = { files: Files; timer: FakeTimer; source: SimSource };
function mount(hash: string, files: Files = allFiles()): Env {
  window.location.hash = `#/canli/${hash}`;
  const kfiles = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v]));
  kfiles["/k/registry.json"] = JSON.stringify(contractRegistryRaw());
  const timer = fakeTimer();
  const source = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(kfiles), timer, computeMs: 300 });
  render(
    <SimSourceProvider source={source}>
      <Ekran />
    </SimSourceProvider>,
  );
  return { files: kfiles, timer, source };
}

const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const hafta = (n: number) => t("canli.hafta", { n, toplam: 200 });
/** "Hafta N / T" üst çubukta ve saat çubuğunda görünür; saat çubuğuna daraltılır. */
const haftaBul = (n: number) => waitFor(() => expect(within(screen.getByRole("region", { name: t("canli.saat") })).getByText(hafta(n))).toBeInTheDocument());
async function adim(n: number, from = 0) {
  for (let i = 1; i <= n; i++) {
    fireEvent.click(btn(t("canli.tek_hafta")));
    await haftaBul(from + i);
  }
}
async function uygula(env: Env, week: number, to: "kisa_sureli" | "kurtarma_fonuyla") {
  await degistirAcDiyalog();
  gecisSec(to);
  fireEvent.click(btn(t("degistir.uygula", { n: week + 1 })));
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    env.timer.advance(300);
  });
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

describe("I1: kaynak hatası Canlı ekranı değiştirmez (gerçek ReplaySource)", () => {
  it("degisiklik_kaydi_404_uyari_bandi_koşu_yerinde_yeniden_dene_calisir", async () => {
    const files = allFiles();
    const missing = Object.keys(files).filter((k) => k.includes("/kurtarma/"));
    const kept = Object.fromEntries(missing.map((k) => [k, files[k]!]));
    for (const k of missing) delete files[k];
    const env = mount(rid(), files);
    await haftaBul(0);
    await adim(5);

    await uygula(env, 5, "kurtarma_fonuyla");
    expect(await screen.findByText(t("hata.degisiklik_basarisiz"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("durum.yeniden") })).toBeNull();
    expect(screen.getByText(t("sart.degistir.red.invalid"))).toBeInTheDocument(); // panel açık, kendi bandıyla
    await haftaBul(5);
    fireEvent.click(btn(t("degistir.kapat")));
    fireEvent.click(btn(t("sart.degistir.kapat_at"))); // değişiklik var: onay istenir
    expect(btn(t("canli.oynat"))).toBeEnabled();
    expect(btn(t("canli.tek_hafta"))).toBeEnabled();

    // Kayıt geri gelir: yeniden dene çalışır, uyarı bir sonraki state olayında silinir.
    Object.assign(env.files, kept);
    await uygula(env, 5, "kurtarma_fonuyla");
    await waitFor(() => expect(screen.queryByText(t("hata.degisiklik_basarisiz"))).toBeNull());
    expect(screen.getByText(t("canli.surum", { n: 2 }))).toBeInTheDocument();
    await haftaBul(5);
    env.source.dispose();
  });
});

describe("Kayıt kaynağında Şartı değiştir", () => {
  it("replay_only_gecis_destegi_open_others_kayit_yok", async () => {
    const env = mount(rid());
    await haftaBul(0);
    const dlg = await degistirAcDiyalog();
    const gecis = within(dlg).getByRole("group", { name: t("setting.gecis_destegi.name") });
    for (const b of within(gecis).getAllByRole("button")) expect(b).toBeEnabled();
    fireEvent.click(within(within(dlg).getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: /Vergiler/ }));
    const kart = within(dlg).getByRole("article", { name: "Ücret stopajı" });
    expect(within(kart).getByRole("textbox")).toBeDisabled();
    expect(within(kart).getByRole("textbox")).toHaveAccessibleDescription(new RegExp(t("kart.kayit_yok")));
    env.source.dispose();
  });
});

describe("I2: aynı hafta ikinci değişiklik tek sürüm girdisi", () => {
  const zaman = (): string[] => [...document.querySelectorAll("section[aria-labelledby=zaman] li")].map((l) => l.textContent ?? "");
  const surumOlaylari = () => screen.queryAllByText(t("event.version", { hafta: 5 }));
  /** Ayrıntılar > Zaman çizgisi sürüm satırları ve Olaylar'daki tek sürüm olayı; pencere sonunda kapanır. */
  const sureleriDogrula = async (beklenen: string[]) => {
    await ayrintilariAc("Genel"); // ilk haftanın gerçekten geldiği (karşılama ölçüsü dolu) görülür, sonra sekme
    await waitFor(() => expect(document.querySelector('[data-olcu="karsilama"] dd')?.textContent).not.toBe("–"));
    await ayrintilariAc("Zaman çizgisi");
    await waitFor(() => expect(zaman()).toEqual(beklenen));
    await ayrintilariAc("Olaylar");
    expect(surumOlaylari()).toHaveLength(1);
    ayrintilariKapat();
  };

  it("canli_iki_degisiklik_tek_satir_tek_olay_baslik_v2", async () => {
    const env = mount(rid());
    await haftaBul(0);
    await adim(5);
    await uygula(env, 5, "kurtarma_fonuyla");
    await screen.findByText(t("canli.surum", { n: 2 }));
    await sureleriDogrula([t("canli.surum_satir", { n: 1, a: 0, b: 5 }), t("canli.surum_satir", { n: 2, a: 5, b: 5 })]);

    fireEvent.click(screen.getByRole("button", { name: t("degistir.dugme") }));
    expect(await screen.findByRole("heading", { name: t("degistir.baslik_ayni", { a: 2 }) })).toBeInTheDocument();
    fireEvent.click(btn(t("degistir.kapat")));
    await uygula(env, 5, "kisa_sureli");
    await waitFor(() => expect(screen.queryByRole("heading", { name: t("degistir.baslik_ayni", { a: 2 }) })).toBeNull());
    await sureleriDogrula([t("canli.surum_satir", { n: 1, a: 0, b: 5 }), t("canli.surum_satir", { n: 2, a: 5, b: 5 })]);

    await adim(1, 5); // hafta 6: başlık yeniden v2 -> v3
    fireEvent.click(screen.getByRole("button", { name: t("degistir.dugme") }));
    expect(await screen.findByRole("heading", { name: t("degistir.baslik", { a: 2, b: 3 }) })).toBeInTheDocument();
    env.source.dispose();
  });

  it("yeniden_acilan_kosu_tek_surum_satiri", async () => {
    const env = mount(rid([{ week: 5, setId: "kisa" }]));
    await haftaBul(0);
    await adim(6);
    await sureleriDogrula([t("canli.surum_satir", { n: 1, a: 0, b: 5 }), t("canli.surum_satir", { n: 2, a: 5, b: 6 })]);
    env.source.dispose();
  });
});

describe("I4: dünya adı canlı başlıkta", () => {
  it("gercek_kaynak_start_ad_ve_sehir_adlari_state_te", async () => {
    const source = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(allFiles()), timer: fakeTimer() });
    const h = await source.start({ name: "Ada Dünyası", cityNames: CITIES, templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } });
    expect(h.state).toMatchObject({ name: "Ada Dünyası", cityNames: CITIES });
    const o = await source.open(rid());
    expect(o?.state).toMatchObject({ name: "Ada Dünyası", cityNames: CITIES });
    source.dispose();
  });

  it("canli_baslik_dunya_adini_gosterir", async () => {
    window.location.hash = "#/canli/r";
    const src = createFakeSource([
      { type: "state", state: { runId: "r", status: "paused", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "kapali", name: "Ada Dünyası", cityNames: CITIES } },
    ]);
    render(
      <SimSourceProvider source={src}>
        <Canli runId="r" restore={{ status: "ready" }} />
      </SimSourceProvider>,
    );
    expect(await screen.findByText(t("canli.baslik", { ad: "Ada Dünyası" }))).toBeInTheDocument();
  });
});
