"use client";
import { useEffect, useRef, useState } from "react";
import { t } from "@/oyun/copy/t";
import ekranRenkleri from "@/oyun/ekran/ekranRenkleri.module.css";
import { BOYLAR, katalogKaydi, SABLONLAR, VARSAYILAN_KATALOG, type BinaKatalogu, type KatalogKaydi } from "@/oyun/harita/binaKatalogu";
import { VARLIK_STILI } from "@/oyun/harita/haritaStili";
import { VarlikYukleyici } from "@/oyun/harita/varlikYukleyici";
import { useOyunTercihleri } from "@/oyun/hooks/useOyunTercihleri";
import { kokTakmaAdlari, stilAcik } from "./stilYardim";
import stil from "./StilOnizleme.module.css";

type Sonuc = { url: string } | { hata: true };
const anahtar = (s: string, b: number): string => `${s}-${b}`;

/** `#/stil`: yükleyicinin gerçek yoluyla her şablon x boy görüntüsü, katalog kaydı ve `.kok` takma adları. */
export function StilOnizleme({ katalog = VARSAYILAN_KATALOG }: { katalog?: BinaKatalogu }) {
  const [acik] = useState(stilAcik);
  return acik ? <Sayfa katalog={katalog} /> : <p role="status">{t("stil.kapali")}</p>;
}

/**
 * Çapa noktası (çapraz çizgi) ve taban kutusu, resmin üstüne 0-1 birim kutusunda çizilir. Resim sahnede taban genişliği x `genislikCarpani`
 * kadar geniştir; çapa ayak izinin alt kenarına oturur (sahnedeki yerleşimle aynı). Renk ve çizgi kalınlığı CSS modülünden.
 */
function Bindirme({ anahtar: ak, oran, kayit }: { anahtar: string; oran: number | undefined; kayit: KatalogKaydi }) {
  if (oran === undefined) return null;
  const genis = kayit.taban.g / (kayit.taban.g * VARLIK_STILI.genislikCarpani);
  const yuksek = kayit.taban.d / (kayit.taban.g * VARLIK_STILI.genislikCarpani * oran);
  return (
    <svg className={stil.bindirme} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" data-testid={`stil-bindirme-${ak}`}>
      <rect className={stil.tabanKutu} data-taban x={kayit.capa.x - genis / 2} y={kayit.capa.y - yuksek} width={genis} height={yuksek} />
      <line className={stil.capaCizgi} data-capa x1={kayit.capa.x} x2={kayit.capa.x} y1={0} y2={1} />
      <line className={stil.capaCizgi} x1={0} x2={1} y1={kayit.capa.y} y2={kayit.capa.y} />
    </svg>
  );
}

function Sayfa({ katalog }: { katalog: BinaKatalogu }) {
  const { tema, toggleTema } = useOyunTercihleri();
  const kok = useRef<HTMLElement>(null);
  const [yenile, setYenile] = useState(0);
  const [sonuc, setSonuc] = useState<Record<string, Sonuc>>({});
  const [oranlar, setOranlar] = useState<Record<string, number>>({});
  const [adlar, setAdlar] = useState<string[]>([]);
  const [degerler, setDegerler] = useState<Record<string, string>>({});
  const yukleyici = useRef<VarlikYukleyici<string> | null>(null);
  const bag = useRef({ tema, yenile });

  useEffect(() => {
    bag.current = { tema, yenile };
  }, [tema, yenile]);

  useEffect(() => {
    const y = new VarlikYukleyici<string>({
      renk: (ad) => getComputedStyle(kok.current ?? document.documentElement).getPropertyValue(ad).trim(),
      getir: async (yol) => {
        const r = await fetch(yol, { cache: "reload" });
        if (!r.ok) throw new Error(`${yol}: ${r.status}`);
        return r.text();
      },
      dokuYap: async (k) => ("svg" in k ? URL.createObjectURL(new Blob([k.svg], { type: "image/svg+xml" })) : `${k.url}?v=${bag.current.yenile}`),
      tema: () => `${bag.current.tema}|${bag.current.yenile}`,
      koyu: () => bag.current.tema === "dark",
      dokuYoket: (u) => {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      },
      katalog,
    });
    yukleyici.current = y;
    return () => {
      y.yoket();
      yukleyici.current = null;
    };
  }, [katalog]);

  useEffect(() => {
    const y = yukleyici.current;
    if (y === null) return;
    let iptal = false;
    void (async () => {
      const cift = SABLONLAR.flatMap((s) => BOYLAR.map((b) => [s, b] as const));
      const bitti = await Promise.all(cift.map(async ([s, b]): Promise<[string, Sonuc]> => {
        try {
          return [anahtar(s, b), { url: await y.doku(s, b) }];
        } catch {
          return [anahtar(s, b), { hata: true }];
        }
      }));
      if (iptal) return;
      const yeni = Object.fromEntries(bitti);
      setSonuc(yeni);
      y.emekliyiAt(new Set(bitti.flatMap(([, r]) => ("url" in r ? [r.url] : []))));
    })();
    return () => {
      iptal = true;
    };
  }, [katalog, tema, yenile]);

  // Takma ad değerleri tema değişince yeniden okunur (tokenler temaya göre çözülür).
  useEffect(() => {
    const el = kok.current;
    if (el === null) return;
    const ad = kokTakmaAdlari(document.styleSheets, ekranRenkleri.kok ?? "kok");
    const cs = getComputedStyle(el);
    setAdlar(ad);
    setDegerler(Object.fromEntries(ad.map((a) => [a, cs.getPropertyValue(a).trim()])));
  }, [tema, yenile]);

  return (
    <section ref={kok} className={`${ekranRenkleri.kok} ${stil.sayfa}`} aria-labelledby="stil-baslik">
      <header>
        <h1 id="stil-baslik" className={stil.baslik}>{t("stil.baslik")}</h1>
        <p className={stil.alt}>{t("stil.aciklama")}</p>
      </header>
      <div className={stil.kontroller}>
        <button type="button" className={stil.dugme} onClick={toggleTema}>
          {tema === "dark" ? t("ustcubuk.tema_acik") : t("ustcubuk.tema_koyu")}
        </button>
        <button type="button" className={stil.dugme} onClick={() => setYenile((n) => n + 1)}>{t("stil.yenile")}</button>
      </div>
      {SABLONLAR.map((s) => (
        <section key={s} className={stil.sablon} aria-labelledby={`stil-s-${s}`}>
          <h3 id={`stil-s-${s}`} className={stil.sablonAd}><code>{s}</code></h3>
          <ul className={stil.boylar}>
            {BOYLAR.map((b) => {
              const k = katalogKaydi(s, b, katalog);
              const r = sonuc[anahtar(s, b)];
              return (
                <li key={b} className={stil.kart} data-testid={`stil-${s}-${b}`}>
                  {r && "url" in r ? (
                    <div className={stil.resimKap}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- blob/yerel önizleme, optimize edilecek bir kaynak değil */}
                      <img
                        className={stil.resim}
                        src={r.url}
                        alt={t("stil.resim_alt", { sablon: s, boy: b })}
                        onLoad={(e) => {
                          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                          if (w > 0 && h > 0) setOranlar((o) => ({ ...o, [anahtar(s, b)]: h / w }));
                        }}
                      />
                      <Bindirme anahtar={anahtar(s, b)} oran={oranlar[anahtar(s, b)]} kayit={k} />
                    </div>
                  ) : (
                    <p className={stil.yerTutucu} role={r ? "alert" : undefined}>{r ? t("stil.dosya_yuklenemedi") : t("stil.yukleniyor")}</p>
                  )}
                  <dl className={stil.kayit}>
                    <dt>{t("stil.boy")}</dt><dd>{b}</dd>
                    <dt>{t("stil.dosya")}</dt><dd><code>{k.dosya}</code></dd>
                    {k.dosyaKoyu ? (<><dt>{t("stil.dosya_koyu")}</dt><dd><code>{k.dosyaKoyu}</code></dd></>) : null}
                    <dt>{t("stil.tur")}</dt><dd>{k.tur}</dd>
                    <dt>{t("stil.capa")}</dt><dd>{t("stil.cift_bol", { a: k.capa.x, b: k.capa.y })}</dd>
                    <dt>{t("stil.taban")}</dt><dd>{t("stil.cift_x", { a: k.taban.g, b: k.taban.d })}</dd>
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section className={stil.sablon} aria-labelledby="stil-takma">
        <h3 id="stil-takma" className={stil.sablonAd}>{t("stil.takma_baslik")}</h3>
        <p className={stil.alt}>{t("stil.takma_not")}</p>
        {adlar.length === 0 ? <p className={stil.alt}>{t("stil.takma_yok")}</p> : (
          <ul className={stil.takmalar}>
            {adlar.map((a) => (
              <li key={a} className={stil.takma} data-testid="stil-takma-ad">
                <svg className={stil.kutu} aria-hidden="true"><rect width="100%" height="100%" fill={degerler[a] ?? ""} /></svg>
                <span className={stil.takmaMetin}>
                  <code className={stil.takmaAd}>{a}</code>
                  <span className={stil.takmaDeger}>{degerler[a]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
