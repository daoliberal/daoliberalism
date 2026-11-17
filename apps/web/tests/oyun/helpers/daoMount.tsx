import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { DaoEkrani } from "@/oyun/screens/dao/DaoEkrani";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { DaoGozlem } from "@/oyun/sim/dao";
import type { RunState, SimEvent, WeekPacket } from "@/oyun/sim/types";
import { packetOf } from "./fakeLiveServer";
import { createFakeSource, type FakeOpts } from "./fakeSource";

/** DAO şehir ekranı testleri için ortak kurulum: sahte kaynak, tablo (WebGL yokken erişilebilir liste), seçim ve panel yardımcıları. */
export const DAO_ADLAR = ["Közlüdere", "Yaldızova", "Bakırbük", "Demirpınar", "Taşyaka"];

export const daoDurum = (over: Partial<RunState> = {}): RunState => ({
  runId: "r", status: "paused", week: 3, durationWeeks: 520, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "canli", name: "Dünya", cityNames: DAO_ADLAR, mode: "dao", ...over,
});

/** Haritada oyuncunun şehrinde (0) f7 firini ve şehir 1'de f2 marketi var. */
export const HARITA_ORNEK = (hafta: number) => ({ hafta, firmalar: [["f7", "firin", 0, 8, null, "npc"], ["f2", "market", 1, 5, null, "npc"]] });

export const daoHafta = (g: DaoGozlem, harita = true): SimEvent => ({
  type: "week", packet: { ...packetOf("r", g.hafta, 1), dao: g, ...(harita ? { harita: HARITA_ORNEK(g.hafta) } : {}) } as unknown as WeekPacket,
});

export type DaoKur = {
  state?: Partial<RunState>;
  karar?: (k: unknown) => Promise<{ kabul: true; hafta: number }>;
  harita?: boolean;
  drawer?: FakeOpts["drawer"];
  route?: { sehir?: 0 | 1 | 2 | 3 | 4 };
  caps?: FakeOpts["caps"];
};

/** `g` null: hafta 0 (ilk paket yok; sunucu `hazirlaniyor` döner). */
export function mountDao(g: DaoGozlem | null, o: DaoKur = {}) {
  window.location.hash = o.route?.sehir !== undefined ? `#/dao/r/${o.route.sehir}` : "#/dao/r";
  const script: SimEvent[] = g === null ? [{ type: "state", state: daoDurum({ week: 0, ...o.state }) }] : [{ type: "state", state: daoDurum({ week: g.hafta, ...o.state }) }, daoHafta(g, o.harita ?? true)];
  const src = createFakeSource(script, { kind: "live", ...(o.drawer ? { drawer: o.drawer } : {}), ...(o.caps ? { caps: o.caps } : {}) });
  const daoKarar = vi.fn(o.karar ?? (async () => ({ kabul: true as const, hafta: (g?.hafta ?? 0) + 1 })));
  const control = vi.spyOn(src, "control");
  const daoGozlem = vi.fn(async () => { if (g === null) throw new SimUnsupported("hazirlaniyor"); return g; });
  Object.assign(src, { daoKarar, daoGozlem });
  const view = render(
    <SimSourceProvider source={src}>
      <DaoEkrani route={{ name: "dao", runId: "r", ...(o.route?.sehir !== undefined ? { sehir: o.route.sehir } : {}) }} />
    </SimSourceProvider>,
  );
  return { src, daoKarar, control, daoGozlem, ...view };
}

/** Yeni hafta yayımlar (durum + paket). */
export function haftaYayimla(src: ReturnType<typeof mountDao>["src"], g: DaoGozlem, state: Partial<RunState> = {}): void {
  act(() => {
    src.emit("r", { type: "state", state: daoDurum({ week: g.hafta, ...state }) });
    src.emit("r", daoHafta(g));
  });
}

/** Harita tablosu: WebGL yokken yedek olarak her zaman açık, kabuğun her eylemi buradan da yapılabilir. */
export const tablo = async () => within(await screen.findByRole("region", { name: /\(liste\)$/ }));
export async function sec(ad: string | RegExp): Promise<void> {
  // Haftalar kabukta kare kare (100 ms) işlenir: düğme görünene dek beklenir.
  fireEvent.click(await (await tablo()).findByRole("button", { name: ad }));
}
/** Sağ (bağlam) paneli: başlığıyla. */
export const sagPanel = (baslik: string) => within(screen.getByRole("complementary", { name: baslik }));
export const solPanel = () => within(screen.getByRole("complementary", { name: t("dao.panel.ben") }));
