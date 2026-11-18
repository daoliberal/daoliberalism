// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rotaPaketKarari, type PaketKarari } from "@/oyun/tarayici/rotaPaket";

const kosu = (kosuId: string): PaketKarari => ({ tur: "kosu", kosuId });
const EV: PaketKarari = { tur: "ev" };
const YENI: PaketKarari = { tur: "yeni_oyun" };
const YOK: PaketKarari = { tur: "yok" };

describe("rotaPaketKarari (rota -> paket tablosu)", () => {
  const tablo: [string, PaketKarari][] = [
    ["#/canli/canli-ab12", kosu("canli-ab12")],
    ["#/canli/canli-ab12/dunya", kosu("canli-ab12")],
    ["#/canli/canli-ab12/3", kosu("canli-ab12")],
    ["#/sonuc/canli-ab12", kosu("canli-ab12")],
    ["#/dao/canli-dao1", kosu("canli-dao1")],
    ["#/dao/canli-dao1/2", kosu("canli-dao1")],
    ["", EV],
    ["#", EV],
    ["#/", EV],
    ["#/kosular", EV],
    ["#/kurucu", YENI],
    ["#/kurucu/rehberli/2", YENI],
    ["#/dao", YENI],
    ["#/dao/", YENI],
    ["#/dao/d/ABC", YOK],
    ["#/stil", YOK],
    ["#/bilinmeyen", YOK],
  ];
  it.each(tablo)("%s", (hash, beklenen) => {
    expect(rotaPaketKarari(hash)).toEqual(beklenen);
  });
});
