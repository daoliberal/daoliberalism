"use client";
import { cx } from "@/components/primitives/cx";
import { t, type CopyKey } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import { urunAdiOf } from "@/oyun/lib/urunAdlari";
import type { Adlandirici } from "@/oyun/harita/adlar";
import type { HaritaRef, SehirSahnesi } from "@/oyun/harita/tipler";
import type { ChainNode, CityRow, HoldingsLonca, WeekPacket } from "@/oyun/sim/types";
import { LineChart } from "@/oyun/ui/LineChart";
import { bin, goster, issizOrani, oran0, sayi, sonlu } from "./bicim";
import { ALANLAR, alanMetni } from "./cekmeceAlanlari";
import { loncaAdi } from "./LoncaTablosu";
import stil from "./KurucuBaglam.module.css";
import { useCekmece } from "./useCekmece";

/** Sağ panelde en çok bu kadar sektör satırı (talebe göre azalan). */
const SEKTOR_SINIRI = 8;
/** Meydan panelinde lonca alanları: `holdings.loncas` satırında bulunanlar (haftalık faiz pakette yok, gösterilmez). */
const LONCA_ALANLARI = ["owner", "members", "fee", "capital", "deposits", "credit_out", "equity"] as const;

export type BaglamSecimi = { ref: HaritaRef; /** Seçildiği anın yayımlanmış haftası (ayrıntı isteği bu haftayı sorar). */ hafta: number };

type Ortak = { cur: WeekPacket; sehir: number; sehirAdlari: string[]; sektorAdi(id: string): string };

/** Panelin başlığı: işletme sektör adı, meydan, şehir adı ya da ahır. */
export function baglamBasligi(secim: BaglamSecimi, sahne: SehirSahnesi, adlar: Adlandirici): string {
  const { kind, ref } = secim.ref;
  if (kind === "firm") {
    const b = sahne.binalar.find((x) => x.id === ref);
    return b ? adlar.bina(b) : ref;
  }
  if (kind === "lonca") return t("kurucu.baglam.meydan");
  if (kind === "city") return adlar.sehir(sahne.ad);
  if (kind === "kurum") return t(ref === "ihracat" ? "harita.ihracat" : "harita.liman");
  return t("harita.ahir");
}

const satir = (etiket: string, deger: string, anahtar: string) => (
  <div key={anahtar} className={stil.satir} data-alan={anahtar}>
    <dt className={stil.etiket}>{etiket}</dt>
    <dd className={stil.deger}>{deger}</dd>
  </div>
);

/** İşletme penceresi: ad, sektör, sahip türü, çalışan, ücret, haftalık satış (ürün, miktar, fiyat), son haftaların kârı. Veri tıklayınca istenir. */
function IsletmePenceresi({ runId, secim, sahne, adlar }: { runId: string; secim: BaglamSecimi; sahne: SehirSahnesi; adlar: Adlandirici }) {
  const { durum, veri } = useCekmece(runId, "firm", secim.ref.ref, secim.hafta);
  const bina = sahne.binalar.find((b) => b.id === secim.ref.ref);
  const f = veri?.fields ?? {};
  const kar = Array.isArray(f.profit_hist) ? (f.profit_hist as unknown[]).filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [];
  const alan = (key: string): string | null => {
    const a = ALANLAR.firm?.find((x) => x.key === key);
    const m = a ? alanMetni(a.bicim, f[key]) : null;
    // Fiyat birimli yazılır ("1,27 Akçe"); ölçülmüyorsa birim eklenmez.
    return key === "price" && m !== null && typeof f[key] === "number" ? t("canli.gosterge.akce", { n: m }) : m;
  };
  const satirlar = [
    ["workers", "kurucu.baglam.calisan"],
    ["wage_avg", "kurucu.baglam.ucret"],
    ["price", "kurucu.baglam.fiyat"],
    ["sold_week", "kurucu.baglam.satis"],
  ] as const;
  const urun = typeof f.product === "string" && f.product !== "" ? f.product : null;
  return (
    <div className={stil.kok} data-baglam="firm">
      {durum === "yukleniyor" ? <p className={stil.not} role="status">{t("cekmece.yukleniyor")}</p> : null}
      {durum === "hata" ? <p className={stil.not} role="alert">{t("cekmece.yuklenemedi")}</p> : null}
      <dl className={stil.liste}>
        {bina ? satir(t("kurucu.baglam.sektor"), adlar.bina(bina), "sektor") : null}
        {bina?.sahip ? satir(t("kurucu.baglam.sahip"), t(`kurucu.baglam.sahip.${bina.sahip}` as CopyKey), "sahip") : null}
        {veri
          ? satirlar.flatMap(([key, etiket]) => {
              const m = alan(key);
              if (m === null) return [];
              return [satir(t(etiket), key === "sold_week" && urun ? t("kurucu.baglam.satis_urun", { n: m, urun }) : m, key)];
            })
          : null}
      </dl>
      {veri ? <p className={stil.not}>{veri.stale ? t("cekmece.eski_hafta", { n: veri.week }) : t("cekmece.hafta", { n: veri.week })}</p> : null}
      {veri && kar.length === 1 ? <p className={stil.not}>{t("kurucu.baglam.kar_yetersiz")}</p> : null}
      {veri && kar.length >= 2 ? (
        <section aria-label={t("kurucu.baglam.kar")} className={stil.grafik}>
          <LineChart titleKey="kurucu.baglam.kar" series={[{ id: "kar", labelKey: "kurucu.baglam.kar", values: kar, styleIndex: 0 }]} />
        </section>
      ) : null}
    </div>
  );
}

/** Lonca meydanı: bütün loncalar (seçili olan açık), toplam mevduat. Alanlar yalnız `holdings.loncas` satırındakiler. */
function Meydan({ cur, secili }: { cur: WeekPacket; secili: string }) {
  const loncalar: HoldingsLonca[] = cur.holdings?.loncas ?? [];
  const toplam = loncalar.reduce((a, l) => (sonlu(l.deposits) ? a + l.deposits : a), 0);
  const olcuVar = loncalar.some((l) => sonlu(l.deposits));
  const alan = (l: HoldingsLonca, key: (typeof LONCA_ALANLARI)[number]) => {
    const a = ALANLAR.lonca?.find((x) => x.key === key);
    const m = a ? alanMetni(a.bicim, l[key]) : null;
    return m === null ? null : satir(t(`cekmece.alan.${key}` as CopyKey), m, key);
  };
  return (
    <div className={stil.kok} data-baglam="lonca">
      <dl className={stil.liste}>{satir(t("kurucu.baglam.toplam_mevduat"), olcuVar ? t("canli.gosterge.akce", { n: sayi(toplam) }) : t("canli.gosterge.olculmuyor"), "toplam")}</dl>
      {loncalar.length === 0 ? <p className={stil.not}>{t("kurucu.baglam.lonca_yok")}</p> : null}
      {[...loncalar].sort((a, b) => Number(b.ref === secili) - Number(a.ref === secili)).map((l) => (
        <details key={l.ref} className={stil.lonca} open={l.ref === secili} data-lonca={l.ref}>
          <summary className={stil.ozet}>{loncaAdi(l.ref)}</summary>
          <dl className={stil.liste}>{LONCA_ALANLARI.map((k) => alan(l, k))}</dl>
        </details>
      ))}
    </div>
  );
}

function SehirBilgisi({ cur, sehir, sehirAdlari, sektorAdi }: Ortak) {
  const satirVeri: CityRow | undefined = cur.cities?.find((c) => c.index === sehir);
  const ad = cityDisplayName(sehirAdlari[sehir] ?? "", sehir);
  const isletme = satirVeri ? (satirVeri.firms_total ?? satirVeri.firms_npc + satirVeri.firms_player) : null;
  const issiz = satirVeri ? issizOrani(satirVeri.employed, satirVeri.unemployed) : null;
  const dugumler: ChainNode[] = (cur.chain?.nodes ?? []).filter((n) => n.city === sehir && sonlu(n.demand)).sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0)).slice(0, SEKTOR_SINIRI);
  return (
    <div className={stil.kok} data-baglam="city">
      <dl className={stil.liste} aria-label={t("kurucu.baglam.sehir_bilgisi", { ad })}>
        {satir(t("kurucu.baglam.nufus"), goster(satirVeri?.population, sayi), "nufus")}
        {satir(t("kurucu.baglam.calisan"), goster(satirVeri?.employed, sayi), "calisan")}
        {satir(t("kurucu.baglam.issiz"), sonlu(satirVeri?.unemployed) ? `${sayi(satirVeri.unemployed)}${issiz !== null ? ` (${oran0(issiz)})` : ""}` : t("canli.gosterge.olculmuyor"), "issiz")}
        {satir(t("kurucu.baglam.isletme"), goster(isletme, sayi), "isletme")}
        {satir(t("kurucu.baglam.kasa"), goster(satirVeri?.cash, (x) => t("canli.gosterge.akce", { n: bin(x) })), "kasa")}
      </dl>
      <section aria-label={t("kurucu.baglam.sektor_talebi")} className={stil.grafik}>
        <div className={stil.baslikSatir}>
          <h3 className={stil.altBaslik}>{t("kurucu.baglam.sektor_talebi")}</h3>
          <span className={stil.not}>{t("kurucu.baglam.ilk_n", { n: SEKTOR_SINIRI })}</span>
        </div>
        {dugumler.length === 0 ? (
          <p className={stil.not}>{t("kurucu.baglam.talep_yok")}</p>
        ) : (
          <table className={stil.tablo}>
            <thead>
              <tr>
                <th scope="col">{t("kurucu.baglam.kol_sektor")}</th>
                <th scope="col" className={stil.sag}>{t("kurucu.baglam.kol_talep")}</th>
                <th scope="col" className={stil.sag}>{t("kurucu.baglam.kol_karsilanan")}</th>
              </tr>
            </thead>
            <tbody>
              {dugumler.map((n) => (
                <tr key={n.sector}>
                  <th scope="row">{sektorAdi(n.sector)}</th>
                  <td className={cx(stil.sag, stil.sayi)}>{goster(n.demand, sayi)}</td>
                  <td className={cx(stil.sag, stil.sayi)}>{sonlu(n.shortage) ? oran0(1 - Math.min(1, Math.max(0, n.shortage))) : t("canli.gosterge.olculmuyor")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Ahir({ cur }: { cur: WeekPacket }) {
  const n = cur.world.players_in_ahir;
  return (
    <div className={stil.kok} data-baglam="ahir">
      <dl className={stil.liste}>{satir(t("kurucu.baglam.bekleyen"), goster(n, sayi), "bekleyen")}</dl>
      <p className={stil.not}>{t("kurucu.baglam.ahir_not")}</p>
    </div>
  );
}

/**
 * Şehir kurumu paneli (Liman = ithalat DAO'su, İhracat): bu şehrin haftalık ithal/ihraç hacmi, Liman'da en çok ithal edilen 5 ürün (ürünü üreten sektörün adıyla) ve kısa açıklama.
 * Veri paketin `kurumlar` alanından gelir; eski sunucuda ve kayıtta yoktur: uydurma sayı yazılmaz.
 */
function Kurum({ cur, sehir, sektorAdi, tur }: Ortak & { tur: "liman" | "ihracat" }) {
  const veri = cur.kurumlar?.find((k) => k.sehir === sehir);
  const urunAdi = (urun: string): string =>
    urunAdiOf(urun, (u) => {
      const sektor = cur.chain?.sectors.find((x) => x.product === u)?.sector;
      return sektor ? sektorAdi(sektor) : null;
    });
  const akce = (x: number): string => t("canli.gosterge.akce", { n: sayi(x) });
  return (
    <div className={stil.kok} data-baglam="kurum" data-kurum={tur}>
      <p className={stil.not}>{t(tur === "liman" ? "kurum.liman.not" : "kurum.ihracat.not")}</p>
      {veri === undefined ? (
        <p className={stil.not}>{t("kurum.veri_yok")}</p>
      ) : tur === "liman" ? (
        <>
          <dl className={stil.liste}>{satir(t("kurum.ithalat_hacim"), akce(veri.ithalat_hacim), "ithalat_hacim")}</dl>
          <section aria-label={t("kurum.en_cok_ithal")} className={stil.grafik}>
            <h3 className={stil.altBaslik}>{t("kurum.en_cok_ithal")}</h3>
            {veri.ithalat_urunler.length === 0 ? (
              <p className={stil.not}>{t("kurum.liman.urun_yok")}</p>
            ) : (
              <ul className={stil.urunler}>
                {veri.ithalat_urunler.map((u) => (
                  <li key={u.urun} data-urun={u.urun} className={stil.urun}>
                    <span>{urunAdi(u.urun)}</span>
                    <span className={stil.sayi}>{oran0(u.pay)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <dl className={stil.liste}>{satir(t("kurum.ihracat_hacim"), akce(veri.ihracat_hacim), "ihracat_hacim")}</dl>
      )}
    </div>
  );
}

type Props = Ortak & { runId: string; secim: BaglamSecimi; sahne: SehirSahnesi; adlar: Adlandirici };

/** Sağ panelin içeriği: seçili işletme penceresi, lonca meydanı, şehir bilgisi, şehir kurumu (Liman, İhracat) ya da ahır. */
export function KurucuBaglam({ runId, secim, sahne, adlar, ...ortak }: Props) {
  switch (secim.ref.kind) {
    case "firm":
      return <IsletmePenceresi runId={runId} secim={secim} sahne={sahne} adlar={adlar} />;
    case "lonca":
      return <Meydan cur={ortak.cur} secili={secim.ref.ref} />;
    case "city":
      return <SehirBilgisi {...ortak} />;
    case "kurum":
      return <Kurum {...ortak} tur={secim.ref.ref === "ihracat" ? "ihracat" : "liman"} />;
    default:
      return <Ahir cur={ortak.cur} />;
  }
}
