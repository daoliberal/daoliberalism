import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import { Canli } from "@/oyun/screens/canli/Canli";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { DrawerData, RunState, SimEvent, WeekPacket } from "@/oyun/sim/types";
import { createFakeSource, type FakeOpts } from "./fakeSource";
import { drawerOf, packet, worldInfo } from "./sehirZincirVeri";

export const ADLAR = ["Ada", "Bora", "Cem", "Dil", "Efe"];

export const state = (over: Partial<RunState> = {}): SimEvent => ({
  type: "state",
  state: { runId: "r", status: "paused", week: 3, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "canli", name: "Dünya", cityNames: ADLAR, ...over },
});
export const week = (p: WeekPacket): SimEvent => ({ type: "week", packet: p });
/** 1..n haftalık paketler (şehir ve zincirli); `last` son haftayı değiştirir. */
export const packets = (n: number, last: Parameters<typeof packet>[1] = {}): SimEvent[] =>
  Array.from({ length: n }, (_, i) => week(packet(i + 1, i + 1 === n ? last : {})));

export type MountOpts = FakeOpts & { drawer?: (r: string, k: string, ref: string, w: number) => Promise<DrawerData> };

/** Canlı kaynak gibi davranan sahte kaynakla `Canli`; şehir ve zincir yetenekleri açıktır. */
export function mountCanli(script: SimEvent[], opts: MountOpts = {}) {
  const drawer = vi.fn(opts.drawer ?? (async (_r: string, kind: string, ref: string) => drawerOf(kind, ref)));
  const src = createFakeSource(script, { kind: "live", caps: { city: true, chain: true }, world: worldInfo(), drawer, ...opts });
  const control = vi.spyOn(src, "control");
  const view = render(
    <SimSourceProvider source={src}>
      <Canli runId="r" restore={{ status: "ready" }} />
    </SimSourceProvider>,
  );
  return { src, control, drawer, view };
}

/** Ayrıntılar penceresini menü düğmesinden açar ve `sekme` sekmesini seçer; pencere öğesini döndürür. */
export async function ayrintilariAc(sekme?: string): Promise<HTMLElement> {
  const dugme = await screen.findByRole("button", { name: "Ayrıntılar" });
  if (screen.queryByRole("dialog", { name: "Ayrıntılar" }) === null) {
    dugme.focus(); // gerçek tıklama düğmeyi odaklar; pencere kapanınca odak ona döner
    fireEvent.click(dugme);
  }
  const pencere = await screen.findByRole("dialog", { name: "Ayrıntılar" });
  if (sekme !== undefined) fireEvent.click(within(pencere).getByRole("tab", { name: sekme }));
  return pencere;
}

/** İlk haftalar ekrana gelene dek bekler (Genel sekmesindeki "çalışan" ölçüsü), sonra `sekme` sekmesini açar. */
export async function ayrintilarHazir(sekme: string): Promise<HTMLElement> {
  await ayrintilariAc("Genel");
  await waitFor(() => expect(document.querySelector('[data-olcu="calisan"] dd')?.textContent).not.toBe("–"));
  return ayrintilariAc(sekme);
}

/** Ayrıntılar penceresini "Kapat" ile kapatır. */
export function ayrintilariKapat(): void {
  const pencere = screen.getByRole("dialog", { name: "Ayrıntılar" });
  fireEvent.click(within(pencere).getByRole("button", { name: "Kapat" }));
}
