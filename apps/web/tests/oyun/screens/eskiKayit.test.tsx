import { readFileSync } from "node:fs";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import type { WeekPacket } from "@/oyun/sim/types";
import { mountCanli, state, week } from "../helpers/canliMount";

/**
 * PLAN-TAKIP T7: `holdings` bloğu ve 8 dilim alanı olmayan GERÇEK eski kayıtla iki yeni panel de bozulmadan açılır, "ölçülmüyor" der.
 * Kayıt repoda değildir: `OYUN_ESKI_KAYIT=<haftalar.jsonl yolu>` verilmezse atlanır (sahibin 500 haftalık kaydı için yerelde koşulur).
 */
const YOL = process.env.OYUN_ESKI_KAYIT;

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));
beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.skipIf(!YOL)("eski kayıt (blok yok)", () => {
  const satirlar = (): WeekPacket[] => (readFileSync(YOL as string, "utf8").trim().split("\n").map((l) => JSON.parse(l) as WeekPacket));

  it("gercek_kayit_blok_ve_dilim_alanlari_icermez", () => {
    const hepsi = satirlar();
    expect(hepsi.length).toBeGreaterThan(0);
    for (const p of hepsi) {
      expect("holdings" in p).toBe(false);
      expect("wealth_top10" in p.world).toBe(false);
    }
  });

  it("iki_yeni_panel_olculmuyor_der_eski_paneller_bozulmaz", async () => {
    const hepsi = satirlar();
    const son = hepsi.length;
    const secili = [hepsi[0]!, hepsi[Math.floor(son / 2)]!, hepsi[son - 1]!];
    mountCanli([state({ week: secili[2]!.week, durationWeeks: 500 }), ...secili.map(week)]);
    await screen.findByRole("group", { name: "Görünüm" });
    const sahiplik = await screen.findByRole("region", { name: t("canli.sahiplik.baslik") });
    const nufus = await screen.findByRole("region", { name: t("canli.nufus.baslik") });
    await waitFor(() => expect(sahiplik.textContent).toContain(t("canli.kesim.olculmuyor.live")));
    expect(sahiplik.textContent).toContain(t("canli.sahiplik.lonca.olculmuyor.live"));
    expect(nufus.textContent).toContain(t("canli.nufus.olculmuyor.live"));
    // eski paneller açık kalır
    expect(screen.getAllByRole("region").length).toBeGreaterThan(5);
    expect(console.error).not.toHaveBeenCalled();
  });
});
