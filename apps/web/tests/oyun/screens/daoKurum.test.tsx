import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { adlandirici } from "@/oyun/harita/adlar";
import type { SehirSahnesi } from "@/oyun/harita/tipler";
import { DaoBaglam, daoBaglamBasligi } from "@/oyun/screens/dao/DaoBaglam";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { WeekPacket } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";
import { packet } from "../helpers/sehirZincirVeri";

afterEach(cleanup);

const sahne = { binalar: [], ad: "Ada" } as unknown as SehirSahnesi;
const adlar = adlandirici();
const cur: WeekPacket = { ...packet(3), kurumlar: [{ sehir: 0, ithalat_hacim: 1200, ihracat_hacim: 800, ithalat_urunler: [{ urun: "un", pay: 0.5 }] }] };
const karar = { gonder: async () => true, mesgul: false, kapali: false, kabul: null, ret: null, sirada: null } as never;
const goster = (ref: "liman" | "ihracat") =>
  render(
    <SimSourceProvider source={createFakeSource([], { kind: "live" })}>
      <DaoBaglam
        runId="r" secim={{ ref: { kind: "kurum", ref }, hafta: 3, sehir: 0 }} sahne={sahne} adlar={adlar} g={null} ad={{} as never} cur={cur} sehir={0} sehirAdlari={["Ada"]}
        sektorAdi={(id) => id} karar={karar} ilkHafta={false} sekme="sehir" onSekme={() => {}}
      />
    </SimSourceProvider>,
  );

describe("DAO: şehir kurumu paneli", () => {
  it("baslik_ve_kurum_icerigi_gozlem_olmadan_da_gelir", () => {
    expect(daoBaglamBasligi({ ref: { kind: "kurum", ref: "liman" }, hafta: 3, sehir: 0 }, sahne, adlar)).toBe("Liman (ithalat)");
    goster("liman");
    const kok = document.querySelector('[data-dao-baglam="kurum"]') as HTMLElement;
    expect(kok).not.toBeNull();
    expect(kok.querySelector('[data-baglam="kurum"][data-kurum="liman"]')).not.toBeNull();
    expect(kok.textContent).toContain(t("canli.gosterge.akce", { n: "1.200" }));
  });

  it("ihracat_paneli", () => {
    goster("ihracat");
    expect(document.querySelector('[data-kurum="ihracat"]')!.textContent).toContain(t("canli.gosterge.akce", { n: "800" }));
  });
});
