import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { DurduDiyalogu } from "@/oyun/screens/rehber/RehberBandi";
import { rehberKosuIsaretle } from "@/oyun/screens/rehber/rehberDurumu";
import { useRehber } from "@/oyun/screens/rehber/useRehber";
import type { RunState, SimSource, WorldEvent } from "@/oyun/sim/types";
import { Diyalog, useDiyalogAcik } from "@/oyun/ui/Diyalog";
import { contractRegistry } from "../helpers/registryFixtures";

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

const olay: WorldEvent = { id: "cokus:3", week: 3, kind: "bad", textKey: "event.cokus", params: { hafta: 3 }, critical: true, sector: null, rule_ids: ["ucret_stopaji"] };

describe("W12 M-a: durdu kutusunda Açılacak kural satırı", () => {
  const kart = () => contractRegistry().cards.find((c) => c.id === "ucret_stopaji")!;
  const ac = (degistirilebilir: boolean) =>
    render(<DurduDiyalogu olay={olay} registry={contractRegistry()} hedef={kart()} degistirilebilir={degistirilebilir} onDegistir={() => {}} onDevam={() => {}} onKapat={() => {}} />);

  it("acilacak_kural_shows_only_when_the_rule_can_be_changed", () => {
    ac(true);
    expect(screen.getByText(t("rehber.durdu.acilacak", { kural: kart().title }))).toBeInTheDocument();
  });

  it("acilacak_kural_is_hidden_when_the_run_has_ended_and_the_box_stays_open", () => {
    ac(false);
    expect(screen.queryByText(/Açılacak kural/)).toBeNull();
    expect(screen.queryByRole("button", { name: t("rehber.durdu.degistir") })).toBeNull();
    expect(screen.getByRole("button", { name: t("rehber.durdu.devam") })).toBeInTheDocument();
  });
});

describe("W12 M-b: ipucu açık diyalog varken bekler; Diyalog sayacı dengede kalır", () => {
  const state = { runId: "r", status: "paused", week: 2, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "k", name: "A", cityNames: [] } as unknown as RunState;
  const source = { control: vi.fn(async () => undefined) } as unknown as SimSource;

  function Host() {
    const rehber = useRehber(source, "r", state, [], false, false);
    const [acik, setAcik] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setAcik((a) => !a)}>diyalog</button>
        {acik ? <Diyalog baslik="Başka kutu" onKapat={() => setAcik(false)} /> : null}
        {rehber.ipucu ? <p>{t(rehber.ipucu.metin)}</p> : null}
      </div>
    );
  }

  it("hint_waits_while_another_dialog_is_open_and_returns_after_it_closes", () => {
    rehberKosuIsaretle("r", true);
    render(<Host />);
    expect(screen.getByText(t("rehber.ipucu.a"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "diyalog" }));
    expect(screen.getByRole("dialog", { name: "Başka kutu" })).toBeInTheDocument();
    expect(screen.queryByText(t("rehber.ipucu.a"))).toBeNull();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("diyalog.kapat") }));
    expect(screen.getByText(t("rehber.ipucu.a"))).toBeInTheDocument();
  });

  it("dialog_counter_is_balanced_under_strict_mode_mount_and_unmount", () => {
    const sayac = renderHook(() => useDiyalogAcik());
    expect(sayac.result.current).toBe(false);
    // İki kutu aynı anda açılmaz (odak tuzağı çakışır): ardışık bağla/çöz; sızıntı sayacı yukarıda, taşma aşağıda bırakır.
    const a = render(<StrictMode><Diyalog baslik="A" onKapat={() => {}} /></StrictMode>);
    expect(sayac.result.current).toBe(true);
    a.unmount();
    expect(sayac.result.current).toBe(false); // StrictMode çift bağlamada sızıntı yok
    const b = render(<StrictMode><Diyalog baslik="B" onKapat={() => {}} /></StrictMode>);
    expect(sayac.result.current).toBe(true); // önceki çözme sayacı sıfırın altına indirmedi
    b.unmount();
    expect(sayac.result.current).toBe(false);
  });

  it("an_uncounted_dialog_does_not_block_hints", () => {
    const sayac = renderHook(() => useDiyalogAcik());
    const g = render(<Diyalog baslik="Rehber" sayilir={false} onKapat={() => {}} />);
    expect(sayac.result.current).toBe(false);
    g.unmount();
  });
});
