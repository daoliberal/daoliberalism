import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Table } from "@/components/primitives/Table";
import { t, type CopyKey } from "@/oyun/copy/t";
import { cityDisplayName } from "@/oyun/lib/names";
import { guncelHarita } from "@/oyun/harita/haritaKaynagi";
import { boyDagilimi, enBuyukFirmalar, firmaSeri, hareketSeri, harcamaSeri, ozelIstihdamSeri, type SeriNokta } from "@/oyun/sim/ekonomiSeri";
import type { Hareket, WeekPacket } from "@/oyun/sim/types";
import { LineChart, type ChartSeries } from "@/oyun/ui/LineChart";
import { goster, issizOrani, oran1, sayi, sonlu } from "./bicim";
import styles from "./Canli.module.css";
import cubuk from "./IsletmeIsgucu.module.css";
import { useCekmece } from "./useCekmece";

type Props = {
  weeks: WeekPacket[]; cur: WeekPacket | null; sehir: number | null; sehirAdlari: string[];
  sektorAdi(tur: string): string; isLive: boolean; runId: string;
};

const kisi = (x: number) => t("isletme.kisi", { n: sayi(x) });
const BOY: readonly CopyKey[] = ["isletme.boy.k1", "isletme.boy.k2", "isletme.boy.k3", "isletme.boy.k4"];
const HAREKETLER: readonly (readonly [keyof Hareket, CopyKey, 0 | 1 | 2 | 3])[] = [
  ["kurulan", "isletme.hareket.kurulan", 0], ["buyuyen", "isletme.hareket.buyuyen", 1], ["kuculen", "isletme.hareket.kuculen", 2], ["batan", "isletme.hareket.batan", 3],
];

/** Değerlerin toplamı; biri bile ölçülmediyse `null` (eksik toplam uydurma sayı verirdi). */
function topla(v: readonly (number | null | undefined)[]): number | null {
  if (v.length === 0) return null;
  let s = 0;
  for (const x of v) { if (!sonlu(x)) return null; s += x; }
  return s;
}

/** Seriyi kendi ilk ölçülen (sıfırdan büyük) değerine göre endeksler (ilk = 100); null korunur. */
function endeks(values: SeriNokta[]): SeriNokta[] {
  const ilk = values.findIndex((v) => sonlu(v) && v > 0);
  if (ilk < 0) return values.map(() => null);
  const taban = values[ilk] as number;
  // Tabandan önceki haftalar ölçülmemiş sayılır (0 çizmek "çöküş" gibi görünürdü).
  return values.map((v, i) => (i < ilk || v === null ? null : (v / taban) * 100));
}

/** Endeks serisinin son ölçülen değeri 100'e göre değişim metni: "+%34" ya da "−%12"; ölçüm yoksa null. */
function degisimMetni(endeksSeri: SeriNokta[]): string | null {
  for (let i = endeksSeri.length - 1; i >= 0; i--) {
    const v = endeksSeri[i];
    if (sonlu(v)) {
      const d = Math.round(v - 100);
      return d < 0 ? `−%${sayi(-d)}` : `+%${sayi(d)}`;
    }
  }
  return null;
}

/** Seçili işletmenin çalışan serisi: harita kaydı (ara haftalarda yaklaşık) + işletme çekmecesinden gelen kesin bu hafta değeri. */
function FirmaCalisan({ weeks, cur, id, ad, runId }: { weeks: WeekPacket[]; cur: WeekPacket; id: string; ad: string; runId: string }) {
  const d = useCekmece(runId, "firm", id, cur.week);
  const harita = useMemo(() => firmaSeri(weeks, id), [weeks, id]);
  const sayiW = d.durum === "hazir" ? d.veri?.fields.workers : undefined;
  const kesinHafta = d.durum === "hazir" ? d.veri?.week : undefined;
  const yeni = useMemo(() => (typeof sayiW === "number" && Number.isFinite(sayiW) && kesinHafta !== undefined ? { hafta: kesinHafta, calisan: sayiW } : null), [sayiW, kesinHafta]);
  // Yeni hafta isteği sürerken aynı işletmenin son kesin değeri kalır (not ve nokta titremesin).
  const son = useRef<{ id: string; hafta: number; calisan: number } | null>(null);
  if (yeni !== null) son.current = { id, ...yeni };
  const kesin = yeni ?? (son.current !== null && son.current.id === id ? son.current : null);
  const values = useMemo(() => {
    if (kesin === null || kesin.hafta < 1 || kesin.hafta > harita.length) return harita;
    return harita.map((v, i) => (i === kesin.hafta - 1 ? kesin.calisan : v));
  }, [harita, kesin]);
  const yaklasik = weeks.some((w) => w.harita === undefined && w.haritaFark !== undefined);
  const seriler: ChartSeries[] = [{ id: "firma", labelKey: "seri.firma_calisan", styleIndex: 0, values }];
  return (
    <div className={styles.bolum} data-isletme="firma_seri">
      <LineChart titleKey="isletme.firma.grafik" titleParams={{ ad }} series={seriler} />
      {kesin !== null ? <p className={styles.kucuk} data-isletme="firma_kesin">{t("isletme.firma.kesin", { n: kesin.hafta, calisan: kesin.calisan })}</p> : null}
      {yaklasik ? <p className={styles.kucuk} data-isletme="firma_yaklasik">{t("isletme.firma.yaklasik")}</p> : null}
    </div>
  );
}

/**
 * İşletmeler ve iş gücü: kaç kişi çalışıyor (oyuncu ve yerleşik halk ayrı), kaç kişi iş arıyor, iş gücü dışında kalanlar, işletme büyüklüğü dağılımı,
 * haftalık kurulan / büyüyen / küçülen / batan işletme, sektöre göre çalışan, harcama ile özel istihdamın aynı grafikte (endeks) ve seçilen işletmenin çalışan serisi.
 * Şehir seçiliyse istihdam, büyüklük, hareket ve harcama o şehirdir; sektör tablosu her zaman tüm dünyadır (rozetle). Ölçülmeyen değer "ölçülmüyor", grafikte boşluktur.
 */
export function IsletmeIsgucuPaneli({ weeks, cur, sehir, sehirAdlari, sektorAdi, runId }: Props) {
  const [firma, setFirma] = useState<string | null>(null);
  const blokVar = useMemo(() => weeks.some((p) => p.ekonomi !== undefined), [weeks]);
  const seriler = useMemo(() => {
    const harcama = endeks(harcamaSeri(weeks, "toplam", sehir));
    const ozel = endeks(ozelIstihdamSeri(weeks, sehir));
    return {
      harcamaDegisim: degisimMetni(harcama), ozelDegisim: degisimMetni(ozel),
      hareket: HAREKETLER.map(([alan, labelKey, styleIndex]): ChartSeries => ({ id: `hareket-${alan}`, labelKey, styleIndex, values: hareketSeri(weeks, sehir, alan) })),
      birlikte: [
        { id: "harcama", labelKey: "seri.harcama_toplam", styleIndex: 0, values: harcama },
        { id: "ozel", labelKey: "seri.ozel_istihdam", styleIndex: 1, values: ozel },
      ] satisfies ChartSeries[],
    };
  }, [weeks, sehir]);
  const harita = useMemo(() => guncelHarita(weeks), [weeks]);
  const haritaVar = useMemo(() => harita !== null || weeks.some((w) => w.haritaFark !== undefined), [harita, weeks]);
  const buyukler = useMemo(() => enBuyukFirmalar(harita, sehir, 10), [harita, sehir]);

  if (!blokVar) {
    return (
      <section aria-label={t("isletme.baslik")} className={styles.bolum}>
        <h2 className={styles.baslik}>{t("isletme.baslik")}</h2>
        {weeks.length > 0 ? <p className={styles.kucuk}>{t("isletme.eski_sunucu")}</p> : null}
      </section>
    );
  }

  const e = cur?.ekonomi;
  const ad = sehir === null ? null : cityDisplayName(sehirAdlari[sehir] ?? "", sehir);
  const satir = sehir === null ? null : (e?.isletme.sehir.find((s) => s.sehir === sehir) ?? null);
  const sehirler = cur?.cities ?? [];
  const sehirSatiri = sehir === null ? null : (sehirler.find((c) => c.index === sehir) ?? null);
  const istihdam = sehir === null
    ? { oyuncu: e?.isletme.istihdam.oyuncu ?? null, npc: e?.isletme.istihdam.npc ?? null, ozel: e?.isletme.istihdam.ozel ?? null, kamu: e?.isletme.istihdam.kamu ?? null }
    : { oyuncu: satir?.calisan_oyuncu ?? null, npc: satir?.calisan_npc ?? null, ozel: satir?.ozel_calisan ?? null, kamu: satir?.kamu_calisan ?? null };
  const issizOyuncu = sehir === null ? topla(sehirler.map((c) => c.players_seeking)) : (sehirSatiri?.players_seeking ?? null);
  const issizNpc = sehir === null ? topla(sehirler.map((c) => c.npc_pool)) : (sehirSatiri?.npc_pool ?? null);
  const isgucuDisi = sehir === null ? topla(e?.isletme.sehir.map((s) => s.isgucu_disi) ?? []) : (satir?.isgucu_disi ?? null);
  const boy = boyDagilimi(cur, sehir);
  const boyToplam = boy === null ? null : boy.reduce((a, b) => a + b, 0);
  const boyEn = boy === null ? 0 : Math.max(1, ...boy);
  const hareket = sehir === null ? (e?.isletme.hareket ?? null) : (satir?.hareket ?? null);
  const harcamaToplam = sehir === null ? (e?.tuketim.harcama?.toplam ?? null) : (() => {
    const h = e?.tuketim.hane.sehir.find((s) => s.sehir === sehir)?.harcama ?? null;
    return h === null || h.oyuncu === null || h.npc === null ? null : h.oyuncu + h.npc;
  })();
  const sektorler = [...(e?.isletme.sektor ?? [])].sort((a, b) => b.calisan - a.calisan);
  const sektorToplam = sektorler.reduce((s, x) => s + x.calisan, 0) + (e?.isletme.sektor_diger?.calisan ?? 0);
  const payOf = (c: number): string => (sektorToplam > 0 ? oran1(c / sektorToplam) : goster(null, oran1));
  const firmaSecili = firma !== null ? (buyukler.find((f) => f.id === firma) ?? null) : null;

  const olcu = (id: string, etiket: CopyKey, deger: number | null, alt?: string) => (
    <div key={id} className={styles.olcu} data-isletme={id}>
      <dt className={styles.etiket}>{t(etiket)}</dt>
      <dd className={styles.deger}>{goster(deger, kisi)}</dd>
      {alt !== undefined ? <dd className={styles.fark}>{alt}</dd> : null}
    </div>
  );
  const oranMetni = (calisan: number | null, issiz: number | null): string | undefined => {
    const o = issizOrani(calisan, issiz);
    return o === null ? undefined : t("isletme.issiz.oran", { oran: oran1(o) });
  };

  return (
    <section aria-label={t("isletme.baslik")} className={styles.bolum}>
      <h2 className={styles.baslik}>{t("isletme.baslik")}</h2>
      <p className={styles.kucuk}>{t("isletme.alt")}</p>
      <p className={styles.etiket} data-isletme="kapsam">{ad === null ? t("tuketim.dunya_rozeti") : t("tuketim.sehir_rozeti", { ad })}</p>

      <h3 className={styles.baslik}>{t("isletme.istihdam.baslik")}</h3>
      <dl className={styles.serit}>
        {olcu("oyuncu", "isletme.istihdam.oyuncu", istihdam.oyuncu)}
        {olcu("npc", "isletme.istihdam.npc", istihdam.npc)}
        {olcu("ozel", "isletme.istihdam.ozel", istihdam.ozel)}
        {olcu("kamu", "isletme.istihdam.kamu", istihdam.kamu)}
        {olcu("issiz_oyuncu", "isletme.issiz.oyuncu", issizOyuncu, oranMetni(istihdam.oyuncu, issizOyuncu))}
        {olcu("issiz_npc", "isletme.issiz.npc", issizNpc, oranMetni(istihdam.npc, issizNpc))}
        {olcu("isgucu_disi", "isletme.isgucu_disi", isgucuDisi)}
      </dl>
      <p className={styles.kucuk}>{t("isletme.isgucu_disi.aciklama")}</p>

      <h3 className={styles.baslik}>{t("isletme.boy.baslik")}</h3>
      {boy === null ? <p className={styles.kucuk}>{goster(null, sayi)}</p> : (
        <>
          <ul className={cubuk.cubuklar}>
            {boy.map((n, i) => {
              const etiket = t(BOY[i]!);
              return (
                <li key={i} className={cubuk.cubuk} data-isletme={`boy_${i + 1}`}>
                  <span className={cubuk.cubukAd}>{etiket}</span>
                  <span className={cubuk.cubukIz}>
                    <progress className={cubuk.cubukCizgi} value={n} max={boyEn} aria-label={t("isletme.boy.satir", { ad: etiket, n: sayi(n) })} />
                    <span className={cubuk.sayi}>{sayi(n)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className={styles.kucuk} data-isletme="boy_toplam">{t("isletme.boy.toplam", { n: sayi(boyToplam ?? 0) })}</p>
        </>
      )}

      <h3 className={styles.baslik}>{t("isletme.hareket.baslik")}</h3>
      <dl className={styles.serit}>
        {HAREKETLER.map(([alan, etiket]) => (
          <div key={alan} className={styles.olcu} data-isletme={`hareket_${alan}`}>
            <dt className={styles.etiket}>{t(etiket)}</dt>
            <dd className={styles.deger}>{goster(hareket?.[alan], sayi)}</dd>
          </div>
        ))}
      </dl>
      <LineChart titleKey="isletme.hareket.grafik" series={seriler.hareket} />
      <p className={styles.kucuk}>{t("isletme.hareket.ilk_hafta")}</p>

      <h3 className={styles.baslik}>{t("isletme.tuketim_istihdam.baslik")}</h3>
      <dl className={styles.serit}>
        <div className={styles.olcu} data-isletme="harcama_toplam">
          <dt className={styles.etiket}>{t("tuketim.harcama.baslik")}</dt>
          <dd className={styles.deger}>{goster(harcamaToplam, (x) => t("canli.gosterge.akce", { n: sayi(x) }))}</dd>
        </div>
        {olcu("ozel_istihdam", "isletme.istihdam.ozel", istihdam.ozel)}
      </dl>
      <ul className={styles.kucuk} data-isletme="endeks_son">
        {seriler.harcamaDegisim === null && seriler.ozelDegisim === null ? <li>{t("isletme.endeks.yok")}</li> : null}
        {seriler.harcamaDegisim !== null ? <li data-isletme="endeks_harcama">{t("isletme.endeks.harcama", { degisim: seriler.harcamaDegisim })}</li> : null}
        {seriler.ozelDegisim !== null ? <li data-isletme="endeks_ozel">{t("isletme.endeks.ozel", { degisim: seriler.ozelDegisim })}</li> : null}
      </ul>
      <LineChart titleKey="isletme.tuketim_istihdam.aciklama" series={seriler.birlikte} referans={100} />
      <p className={styles.kucuk}>{t("isletme.endeks.taban")}</p>
      <p className={styles.kucuk}>{t("isletme.tuketim_istihdam.not")}</p>

      <h3 className={styles.baslik}>{t("isletme.sektor.baslik")}</h3>
      <p className={styles.etiket} data-isletme="sektor_kapsam">{t("tuketim.dunya_rozeti")}</p>
      <Table
        caption={t("isletme.sektor.tablo")} columns="even4" minWidth="md" density="compact" align={["start", "end", "end", "end"]}
        header={[t("isletme.sektor.kol_sektor"), t("isletme.sektor.kol_calisan"), t("isletme.sektor.kol_firma"), t("isletme.sektor.kol_pay")]}
        rows={[
          ...sektorler.map((s) => [sektorAdi(s.tur), sayi(s.calisan), sayi(s.firma), payOf(s.calisan)]),
          ...(e?.isletme.sektor_diger ? [[t("isletme.sektor.diger"), sayi(e.isletme.sektor_diger.calisan), sayi(e.isletme.sektor_diger.firma), payOf(e.isletme.sektor_diger.calisan)]] : []),
        ]}
      />

      <h3 className={styles.baslik}>{t("isletme.firma.baslik")}</h3>
      {!haritaVar ? <p className={styles.kucuk} data-isletme="firma_kayit_yok">{t("isletme.firma.kayit_yok")}</p> : buyukler.length === 0 ? <p className={styles.kucuk}>{t("isletme.firma.bos")}</p> : (
        <>
          <div role="group" aria-label={t("isletme.firma.sec")} className={cubuk.firmalar}>
            {buyukler.map((f, i) => (
              <Button key={f.id} variant="toggle" size="sm" pressed={firma === f.id} onClick={() => setFirma(firma === f.id ? null : f.id)}>
                {t("isletme.firma.satir", { sira: i + 1, tur: sektorAdi(f.tur), calisan: sayi(f.calisan) })}
              </Button>
            ))}
          </div>
          {firmaSecili !== null && cur ? <FirmaCalisan weeks={weeks} cur={cur} id={firmaSecili.id} ad={sektorAdi(firmaSecili.tur)} runId={runId} /> : null}
        </>
      )}
    </section>
  );
}
