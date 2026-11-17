import { describe, expect, it } from "vitest";
import { kaydir, kistir, tekerlekEylemi, ODAK_CARPANI, odakla, OLCEK_EN_COK, sigdir, yakinlastir } from "@/oyun/harita/gorunum";

const dunyaNoktasi = (g: { x: number; y: number; olcek: number }, p: { x: number; y: number }) => ({ x: (p.x - g.x) / g.olcek, y: (p.y - g.y) / g.olcek });

describe("gorunum", () => {
  it("yakinlastir imlecin altındaki dünya noktasını sabit tutar", () => {
    const g = { x: -200, y: -100, olcek: 1.5 };
    const imlec = { x: 400, y: 300 };
    const once = dunyaNoktasi(g, imlec);
    const sonra = yakinlastir(g, imlec, 1.25);
    expect(sonra.olcek).toBeCloseTo(1.875);
    const d = dunyaNoktasi(sonra, imlec);
    expect(d.x).toBeCloseTo(once.x);
    expect(d.y).toBeCloseTo(once.y);
  });

  it("ölçek 0.5 ve 4'te kenetlenir", () => {
    let g = { x: 0, y: 0, olcek: 1 };
    for (let i = 0; i < 20; i++) g = yakinlastir(g, { x: 500, y: 350 }, 1.5);
    expect(g.olcek).toBe(4);
    for (let i = 0; i < 40; i++) g = yakinlastir(g, { x: 500, y: 350 }, 1 / 1.5);
    expect(g.olcek).toBe(0.5);
  });

  it("kaydir harita kutusundan taşmaz", () => {
    const g = { x: -500, y: -350, olcek: 2 };
    expect(kaydir(g, 10_000, 10_000)).toMatchObject({ x: 0, y: 0 });
    expect(kaydir(g, -10_000, -10_000)).toMatchObject({ x: 1000 - 2000, y: 700 - 1400 });
    expect(kaydir(g, 30, -20)).toMatchObject({ x: -470, y: -370 });
    // Harita kutudan küçükse içinde kalır.
    const kucuk = kaydir({ x: 100, y: 100, olcek: 0.5 }, 9999, -9999);
    expect(kucuk.x).toBe(500);
    expect(kucuk.y).toBe(0);
  });

  it("kaydir kutu verilince o kutuya göre sınırlar", () => {
    const g = kaydir({ x: 0, y: 0, olcek: 1 }, -9999, 0, { genislik: 400, yukseklik: 300 });
    expect(g.x).toBe(400 - 1000);
  });

  it("sigdir 1000x700'ü 320x480 kutuya orantıyla sığdırır ve ortalar", () => {
    const g = sigdir({ x: 5, y: 5, olcek: 3 }, 320, 480);
    expect(g.olcek).toBeCloseTo(0.32);
    expect(g.x).toBeCloseTo(0);
    expect(g.y).toBeCloseTo((480 - 700 * 0.32) / 2);
    // Sığdırılmış görünümden uzaklaştırma kutunun altına inebilir, yakınlaştırma yine çalışır.
    const kutu = { genislik: 320, yukseklik: 480 };
    expect(yakinlastir(g, { x: 160, y: 240 }, 0.5, kutu).olcek).toBeCloseTo(0.32);
    expect(yakinlastir(g, { x: 160, y: 240 }, 2, kutu).olcek).toBeCloseTo(0.64);
  });

  it("sigdir geniş kutuda 4'ü aşmaz", () => {
    expect(sigdir({ x: 0, y: 0, olcek: 1 }, 10_000, 7_000).olcek).toBe(4);
  });

  it("sigdir_pay_verilirse_yuzen_ogelerin_disindaki_alana_siglar_ve_ortalar", () => {
    const dunya = { genislik: 800, yukseklik: 400 };
    const pay = { ust: 100, alt: 60, sol: 0, sag: 0 };
    const g = sigdir({ x: 0, y: 0, olcek: 1 }, 1000, 600, dunya, pay);
    // iç alan 1000x440: ölçek min(1000/800, 440/400) = 1.1
    expect(g.olcek).toBeCloseTo(1.1);
    expect(g.y).toBeCloseTo(100 + (440 - 400 * 1.1) / 2);
    expect(g.y).toBeGreaterThanOrEqual(pay.ust - 1e-9);
    expect(g.y + dunya.yukseklik * g.olcek).toBeLessThanOrEqual(600 - pay.alt + 1e-9);
    // paysız çağrı eskisi gibi
    expect(sigdir({ x: 0, y: 0, olcek: 1 }, 1000, 600, dunya)).toEqual(sigdir({ x: 0, y: 0, olcek: 1 }, 1000, 600, dunya, { ust: 0, alt: 0, sol: 0, sag: 0 }));
  });

  it("odakla hedefi serbest alanin ortasina getirir ve olcegi sigdirma olcegi x carpan yapar", () => {
    const dunya = { genislik: 800, yukseklik: 600 };
    const pay = { ust: 100, alt: 50, sol: 0, sag: 300 };
    const g = odakla({ x: 300, y: 300 }, 1000, 700, dunya, pay);
    const sig = sigdir({ x: 0, y: 0, olcek: 1 }, 1000, 700, dunya, pay);
    expect(g.olcek).toBeCloseTo(sig.olcek * ODAK_CARPANI);
    // ortadaki hedef serbest alanın (x 0..700, y 100..650) ortasında
    expect(300 * g.olcek + g.x).toBeCloseTo(350);
    expect(300 * g.olcek + g.y).toBeCloseTo(375);
  });

  it("odakla kenardaki hedefi de tam ortalar (kenar siniri yok)", () => {
    const dunya = { genislik: 800, yukseklik: 600 };
    const g = odakla({ x: 780, y: 590 }, 1000, 700, dunya);
    expect(780 * g.olcek + g.x).toBeCloseTo(500);
    expect(590 * g.olcek + g.y).toBeCloseTo(350);
  });

  const uzaklik = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const orta = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const KUTU = { genislik: 800, yukseklik: 600 };
  const DUNYA = { genislik: 2000, yukseklik: 1500 };

  it("kistir_ortayi_sabit_tutar", () => {
    const g = { x: -300, y: -200, olcek: 1 };
    const onceki = { a: { x: 300, y: 250 }, b: { x: 400, y: 250 } };
    const simdi = { a: { x: 275, y: 250 }, b: { x: 425, y: 250 } }; // aynı orta, açıklık 100 -> 150
    const once = dunyaNoktasi(g, orta(onceki.a, onceki.b));
    const s = kistir(g, onceki, simdi, KUTU, DUNYA);
    expect(s.olcek).toBeCloseTo(1.5);
    const d = dunyaNoktasi(s, orta(simdi.a, simdi.b));
    expect(d.x).toBeCloseTo(once.x);
    expect(d.y).toBeCloseTo(once.y);
  });

  it("kistir_olcek_sinirlarda_kenetlenir", () => {
    const g = { x: -300, y: -200, olcek: 3 };
    const buyuk = kistir(g, { a: { x: 300, y: 300 }, b: { x: 320, y: 300 } }, { a: { x: 100, y: 300 }, b: { x: 700, y: 300 } }, KUTU, DUNYA);
    expect(buyuk.olcek).toBe(OLCEK_EN_COK);
    const kucuk = kistir({ ...g, olcek: 0.8 }, { a: { x: 100, y: 300 }, b: { x: 700, y: 300 } }, { a: { x: 390, y: 300 }, b: { x: 410, y: 300 } }, KUTU, DUNYA);
    expect(kucuk.olcek).toBeCloseTo(0.4); // alt sınır 0.5 ya da (daha küçük kutuya sığıyorsa) sığdırma ölçeği
  });

  it("kistir_orta_kaydirmasini_uygular", () => {
    const g = { x: -300, y: -200, olcek: 1 };
    const onceki = { a: { x: 300, y: 250 }, b: { x: 400, y: 250 } };
    const simdi = { a: { x: 340, y: 270 }, b: { x: 440, y: 270 } }; // aynı açıklık, orta (+40,+20)
    const s = kistir(g, onceki, simdi, KUTU, DUNYA);
    expect(s.olcek).toBeCloseTo(1);
    expect(s.x).toBeCloseTo(-260);
    expect(s.y).toBeCloseTo(-180);
    expect(uzaklik(simdi.a, simdi.b)).toBeCloseTo(uzaklik(onceki.a, onceki.b));
  });

  it("kistir_dunya_disina_tasirmaz", () => {
    const g = { x: -10, y: -10, olcek: 1 };
    const s = kistir(g, { a: { x: 300, y: 300 }, b: { x: 400, y: 300 } }, { a: { x: 700, y: 500 }, b: { x: 800, y: 500 } }, KUTU, DUNYA);
    expect(s.x).toBeLessThanOrEqual(0);
    expect(s.y).toBeLessThanOrEqual(0);
    expect(s.x).toBeGreaterThanOrEqual(KUTU.genislik - DUNYA.genislik * s.olcek);
    expect(s.y).toBeGreaterThanOrEqual(KUTU.yukseklik - DUNYA.yukseklik * s.olcek);
  });

  it("kistir_sifir_aciklikta_olcegi_bozmaz", () => {
    const g = { x: -100, y: -100, olcek: 1 };
    const s = kistir(g, { a: { x: 300, y: 300 }, b: { x: 300, y: 300 } }, { a: { x: 300, y: 300 }, b: { x: 340, y: 300 } }, KUTU, DUNYA);
    expect(Number.isFinite(s.olcek)).toBe(true);
    expect(s.olcek).toBe(1);
  });

  it("sigdir_iso_dunyayi_paylarin_icine_sigdirir", () => {
    const iso = { genislik: 1800, yukseklik: 900 };
    const pay = { ust: 60, alt: 40, sol: 0, sag: 300 };
    const g = sigdir({ x: 0, y: 0, olcek: 1 }, 1000, 700, iso, pay);
    expect(g.olcek).toBeCloseTo(Math.min(700 / 1800, 600 / 900));
    expect(g.x).toBeGreaterThanOrEqual(pay.sol - 1e-6);
    expect(iso.genislik * g.olcek + g.x).toBeLessThanOrEqual(1000 - pay.sag + 1e-6);
    expect(g.y).toBeGreaterThanOrEqual(pay.ust - 1e-6);
    expect(iso.yukseklik * g.olcek + g.y).toBeLessThanOrEqual(700 - pay.alt + 1e-6);
  });

  it("odak_iso_hedefi_serbest_alanin_ortasina_getirir", () => {
    const iso = { genislik: 1800, yukseklik: 900 };
    const pay = { ust: 60, alt: 40, sol: 0, sag: 300 };
    const hedef = { x: 1500, y: 200 };
    const g = odakla(hedef, 1000, 700, iso, pay);
    expect(hedef.x * g.olcek + g.x).toBeCloseTo((pay.sol + 1000 - pay.sag) / 2);
    expect(hedef.y * g.olcek + g.y).toBeCloseTo((pay.ust + 700 - pay.alt) / 2);
  });

  const tk = (o: Partial<{ deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...o });

  it("tekerlek_fare_adimi_yakinlastirir_yukari_yakin_asagi_uzak", () => {
    const yak = tekerlekEylemi(tk({ deltaY: -100 }));
    const uzak = tekerlekEylemi(tk({ deltaY: 100 }));
    expect(yak.tur).toBe("yakin");
    expect(uzak.tur).toBe("yakin");
    if (yak.tur === "yakin" && uzak.tur === "yakin") {
      expect(yak.carpan).toBeGreaterThan(1);
      expect(uzak.carpan).toBeLessThan(1);
      expect(yak.carpan * uzak.carpan).toBeCloseTo(1); // üstel: simetrik
    }
  });

  it("tekerlek_satir_modu_fare_tekerlegidir_ve_piksele_cevrilir", () => {
    const e = tekerlekEylemi(tk({ deltaY: -3, deltaMode: 1 }));
    expect(e.tur).toBe("yakin");
    const kucuk = tekerlekEylemi(tk({ deltaY: -1, deltaMode: 1 }));
    if (e.tur === "yakin" && kucuk.tur === "yakin") expect(e.carpan).toBeGreaterThan(kucuk.carpan);
  });

  it("tekerlek_buyuk_delta_orantili_ama_sinirli", () => {
    const a = tekerlekEylemi(tk({ deltaY: -100 }));
    const b = tekerlekEylemi(tk({ deltaY: -200 }));
    const c = tekerlekEylemi(tk({ deltaY: -100000 }));
    if (a.tur === "yakin" && b.tur === "yakin" && c.tur === "yakin") {
      expect(Math.log(b.carpan)).toBeCloseTo(2 * Math.log(a.carpan));
      expect(c.carpan).toBeLessThan(2.5);
    } else throw new Error("yakin bekleniyordu");
  });

  it("tekerlek_ctrl_trackpad_kistirmasi_ince_katsayi", () => {
    const pinch = tekerlekEylemi(tk({ deltaY: -4, ctrlKey: true }));
    const fare = tekerlekEylemi(tk({ deltaY: -4 }));
    expect(pinch.tur).toBe("yakin");
    if (pinch.tur === "yakin") {
      expect(pinch.carpan).toBeGreaterThan(1);
      expect(pinch.carpan).toBeLessThan(1.1); // tek küçük olay tam adım (1,1) değil
    }
    expect(fare.tur).toBe("kaydir"); // ctrlKey'siz küçük piksel delta = iki parmak kaydırma
  });

  it("tekerlek_ctrlsiz_iki_parmak_kaydirmasi_haritayi_kaydirir", () => {
    const e = tekerlekEylemi(tk({ deltaX: 12, deltaY: 7 }));
    expect(e).toEqual({ tur: "kaydir", dx: -12, dy: -7 });
    const yatay = tekerlekEylemi(tk({ deltaX: 120, deltaY: 100 })); // yatay bileşen: büyük olsa da trackpad
    expect(yatay.tur).toBe("kaydir");
  });
});
