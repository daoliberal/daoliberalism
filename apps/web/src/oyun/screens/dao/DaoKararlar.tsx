"use client";
import { useId, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field } from "@/components/primitives/Field";
import { t } from "@/oyun/copy/t";
import { pct } from "@/oyun/lib/format";
import { DAO_LONCA_KUR_YOLLARI, daoEksikMetni, daoHataAnahtari, loncaKurEksikMetni, type DaoAdlar, type DaoGozlem, type DaoKarar, type DaoLoncaKurYol } from "@/oyun/sim/dao";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import { loncaAdi } from "@/oyun/screens/canli/LoncaTablosu";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { parseNumber } from "@/oyun/ui/SayiGirdisi";
import styles from "./DaoEkrani.module.css";

/** `uygulama`: kabul edilen kararın uygulanacağı hafta (sunucunun söylediği); `gozHafta`: karar verilirken gösterilen gözlemin haftası. */
type Mesaj = { ok: true; tur: DaoKarar["tur"]; uygulama: number; firma?: string } | { ok: false; metin: string; gozHafta: number } | null;

/** Karar verme durumu: bir ekranda tek örnek; bağlam eylemleri (ahırdan çık, ayrıl, taşın, kur, mevduat, çek) aynı kararı paylaşır. */
export type KararDurumu = {
  gonder(k: DaoKarar): Promise<boolean>;
  mesgul: boolean;
  /** Karar verilemez: oyun bitti ya da bir karar gönderiliyor. */
  kapali: boolean;
  /** Görünen kabul bandı (karar uygulama haftası yayımlanınca kalkar); `akis`: ahırdan çıkış/başvuru için "olay" ipucunu da taşır. */
  kabul: { metin: string } | null;
  /** Görünen ret metni (hafta ilerleyince bayatlar ve kalkar). */
  ret: string | null;
  /** Kabul edilmiş, henüz uygulanmamış karar (uygulama haftası yayımlanınca kalkar): tek seferlik kararların düğmesi bu sürede "Sırada" olur. `firma`: başvurunun hedefi. */
  sirada: { tur: DaoKarar["tur"]; hafta: number; firma?: string } | null;
};

/**
 * Karar gönderir. `hafta`: gösterilen gözlemin haftası (gözlem yoksa 0). Kabul edilen kararın haftası sunucunun söylediği değerdir
 * (oynarken yayımlanan hafta + 2 de olabilir); olduğu gibi gösterilir.
 */
export function useDaoKarar(runId: string, hafta: number, bitti: boolean): KararDurumu {
  const source = useSimSource();
  const [mesaj, setMesaj] = useState<Mesaj>(null);
  const [mesgul, setMesgul] = useState(false);
  const gonder = async (k: DaoKarar): Promise<boolean> => {
    if (mesgul || bitti || typeof source.daoKarar !== "function") return false;
    setMesgul(true);
    setMesaj(null);
    try {
      const r = await source.daoKarar(runId, k);
      setMesaj({ ok: true, tur: k.tur, uygulama: r.hafta, ...(k.tur === "basvur" ? { firma: k.firma } : {}) });
      return true;
    } catch (e) {
      setMesaj({ ok: false, metin: t(daoHataAnahtari(e)), gozHafta: hafta });
      return false;
    } finally {
      setMesgul(false);
    }
  };
  const kabulMu = mesaj !== null && mesaj.ok && hafta < mesaj.uygulama;
  const kabul = mesaj !== null && mesaj.ok && kabulMu
    ? { metin: t(mesaj.tur === "ahirdan_cik" || mesaj.tur === "basvur" ? "dao.karar.kabul_akis" : "dao.karar.kabul", { hafta: mesaj.uygulama }) }
    : null;
  const ret = mesaj !== null && !mesaj.ok && hafta === mesaj.gozHafta ? mesaj.metin : null;
  const sirada = mesaj !== null && mesaj.ok && kabulMu ? { tur: mesaj.tur, hafta: mesaj.uygulama, ...(mesaj.firma !== undefined ? { firma: mesaj.firma } : {}) } : null;
  return { gonder, mesgul, kapali: bitti || mesgul, kabul, ret, sirada };
}

/** Panelin altındaki ret metni (onay penceresi açıkken ret pencerenin içinde gösterilir). */
export function KararRet({ k }: { k: KararDurumu }) {
  return k.ret !== null ? <p key="ret" role="alert" className={styles.hata}>{k.ret}</p> : null;
}

/** Ahır: yalnız ahırdayken "Ahırdan çık, iş ara"; ahırdayken `ayril` ve `basvur` reddedilir, çıkmanın tek yolu bu karardır. */
export function AhirdanCikEylemi({ ahirda, k }: { ahirda: boolean; k: KararDurumu }) {
  if (!ahirda) return <p className={styles.kucuk}>{t("dao.ahir.disarida")}</p>;
  const sirada = k.sirada?.tur === "ahirdan_cik" ? k.sirada : null;
  return (
    <div className={styles.bolum}>
      <p className={styles.kucuk}>{t("dao.ahir.ahirda")}</p>
      <div className={styles.dugmeler}>
        <Button variant="primary" size="sm" disabled={k.kapali || sirada !== null} onClick={() => void k.gonder({ tur: "ahirdan_cik" })}>
          {t("dao.ahir.cik")}
        </Button>
      </div>
      {sirada !== null ? <p className={styles.kucuk} role="status">{t("dao.sirada.hafta", { hafta: sirada.hafta })}</p> : null}
    </div>
  );
}

/** Kendi işyerinde "İşten ayrıl" (işletme sahibiyse "İşletmeyi kapat"), onay penceresiyle. Ahırdayken ve işsizken çizilmez. */
export function AyrilEylemi({ g, k }: { g: DaoGozlem; k: KararDurumu }) {
  const [diyalog, setDiyalog] = useState(false);
  const kurucu = g.ben.durum === "kurucu";
  const sirada = k.sirada?.tur === "ayril" ? k.sirada : null;
  return (
    <div className={styles.bolum}>
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" disabled={k.kapali || sirada !== null} onClick={() => setDiyalog(true)}>
          {t(kurucu ? "dao.karar.isletmeyi_kapat" : "dao.karar.ayril")}
        </Button>
      </div>
      {sirada !== null ? <p className={styles.kucuk} role="status">{t("dao.sirada.hafta", { hafta: sirada.hafta })}</p> : null}
      {diyalog ? (
        <Diyalog baslik={t(kurucu ? "dao.ayril.kapat_baslik" : "dao.ayril.baslik")} onKapat={() => setDiyalog(false)} kapatMetni={t("dao.ayril.vazgec")} kapatSonda>
          <p className={styles.sonuc}>{t(kurucu ? "dao.ayril.sahip" : "dao.ayril.calisan")}</p>
          {k.ret !== null ? <p role="alert" className={styles.hata}>{k.ret}</p> : null}
          <div className={styles.dugmeler}>
            <Button variant="primary" size="sm" disabled={k.mesgul} onClick={() => void k.gonder({ tur: "ayril" }).then((ok) => { if (ok) setDiyalog(false); })}>
              {t(kurucu ? "dao.ayril.kapat_onay" : "dao.ayril.onay")}
            </Button>
          </div>
        </Diyalog>
      ) : null}
    </div>
  );
}

/** Başka şehirde "Bu şehre taşın" (taşınmak işten ayırır, bu yüzden onay penceresi). İşletme sahibi taşınamaz. */
export function GocEylemi({ hedef, kurucu, ad, k }: { hedef: number; kurucu: boolean; ad: DaoAdlar; k: KararDurumu }) {
  const [diyalog, setDiyalog] = useState(false);
  return (
    <div className={styles.bolum}>
      {kurucu ? <p className={styles.kucuk}>{t("dao.hata.kurucuyken_goc")}</p> : null}
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" disabled={k.kapali || kurucu} onClick={() => setDiyalog(true)}>
          {t("dao.karar.goc")}
        </Button>
      </div>
      {diyalog ? (
        <Diyalog baslik={t("dao.goc.baslik", { sehir: ad.sehir(hedef) })} onKapat={() => setDiyalog(false)} kapatMetni={t("dao.ayril.vazgec")} kapatSonda>
          <p className={styles.sonuc}>{t("dao.goc.metin")}</p>
          {k.ret !== null ? <p role="alert" className={styles.hata}>{k.ret}</p> : null}
          <div className={styles.dugmeler}>
            <Button variant="primary" size="sm" disabled={k.mesgul} onClick={() => void k.gonder({ tur: "goc", sehir: hedef }).then((ok) => { if (ok) setDiyalog(false); })}>
              {t("dao.goc.onay")}
            </Button>
          </div>
        </Diyalog>
      ) : null}
    </div>
  );
}

/** Boş parselde "İşletme kur": sektör seçimi, eksik şartlar, kur. Seçenekler (sektörler) değişince geçersiz kalan seçim yerine gözlemin ilki geçer; bayat değer gönderilmez. */
export function IsletmeKurEylemi({ g, ad, k, parsel, onKur }: { g: DaoGozlem; ad: DaoAdlar; k: KararDurumu; parsel?: string; onKur?(parsel: string, sektor: string): void }) {
  const uid = useId();
  const [sektorSecim, setSektor] = useState<string | null>(null);
  const sektor = sektorSecim !== null && g.sektorler.some((x) => x.sektor === sektorSecim) ? sektorSecim : (g.sektorler[0]?.sektor ?? "");
  return (
    <div className={styles.bolum}>
      <Field kind="select" id={`${uid}-sektor`} label={t("dao.karar.sektor")} value={sektor} disabled={k.kapali || !g.kurabilir.evet} onChange={(e) => setSektor(e.target.value)}>
        {g.sektorler.map((s) => <option key={s.sektor} value={s.sektor}>{ad.sektor(s.sektor)}</option>)}
      </Field>
      {(g.kurabilir.bekleyen ?? []).includes(sektor) ? <p className={styles.kucuk}>{t("dao.karar.bekleme", { hafta: g.sektorler.find((x) => x.sektor === sektor)?.bekleme ?? 1 })}</p> : null}
      {!g.kurabilir.evet ? (
        <div>
          <p className={styles.kucuk}>{t("dao.karar.eksikler")}</p>
          <ul className={styles.liste}>
            {g.kurabilir.eksikler.map((e, i) => <li key={`${i}-${e}`}>{daoEksikMetni(e, g.kurabilir)}</li>)}
          </ul>
        </div>
      ) : g.ben.is.firma === null ? <p className={styles.kucuk}>{t("dao.karar.kur_issiz_not")}</p> : null}
      <div className={styles.dugmeler}>
        <Button variant="primary" size="sm" disabled={k.kapali || !g.kurabilir.evet || sektor === ""} onClick={() => void k.gonder({ tur: "kur", sektor }).then((ok) => { if (ok && parsel !== undefined) onKur?.(parsel, sektor); })}>
          {t("dao.karar.kur")}
        </Button>
      </div>
    </div>
  );
}

/** Meydanda mevduat tercihi: lonca ve nakitten ayrılacak pay. Kapalı loncalar seçilemez; dolu hesapla başka loncaya geçmeden önce çekmek gerekir. */
export function MevduatEylemi({ g, k }: { g: DaoGozlem; k: KararDurumu }) {
  const uid = useId();
  const b = g.ben;
  const acikLoncalar = g.loncalar.filter((l) => !l.kapali);
  // Seçici kullanıcının seçimini tutar; seçenekler (loncalar) değişince geçersiz kalan seçim yerine gözlemin değeri geçer, bayat değer asla gönderilmez.
  const [loncaSecim, setLonca] = useState<string | null>(null);
  const [oran, setOran] = useState(() => String(Math.round((g.tercih.mevduat?.oran ?? 0.5) * 100)));
  const varsayilanLonca = acikLoncalar.find((l) => l.ad === (g.tercih.mevduat?.lonca ?? b.mevduat.lonca))?.ad ?? acikLoncalar[0]?.ad ?? "";
  const lonca = loncaSecim !== null && (loncaSecim === "" || acikLoncalar.some((l) => l.ad === loncaSecim)) ? loncaSecim : varsayilanLonca;
  const oranSayi = parseNumber(oran);
  const oranHata = Number.isFinite(oranSayi) && oranSayi >= 0 && oranSayi <= 100 ? null : t("dao.karar.oran_gecersiz");
  const dolu = b.mevduat.lonca !== null && b.mevduat.tutar > 0;
  const gecis = dolu && lonca !== "" && lonca !== b.mevduat.lonca;
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-mev`}>
      <h3 id={`${uid}-mev`} className={styles.altBaslik}>{t("dao.karar.mevduat")}</h3>
      <Field kind="select" id={`${uid}-lonca`} label={t("dao.karar.lonca")} value={lonca} disabled={k.kapali} onChange={(e) => setLonca(e.target.value)}>
        <option value="">{t("dao.karar.lonca_yok")}</option>
        {g.loncalar.map((l) => (
          <option key={l.ad} value={l.ad} disabled={l.kapali}>{l.kapali ? t("dao.karar.lonca_kapali", { lonca: loncaAdi(l.ad) }) : loncaAdi(l.ad)}</option>
        ))}
      </Field>
      <Field
        kind="input" id={`${uid}-oran`} label={t("dao.karar.oran")} type="text" inputMode="decimal" suffix="%" value={oran} disabled={k.kapali}
        onChange={(e) => setOran(e.target.value)} {...(oranHata ? { error: oranHata } : {})}
      />
      {gecis ? <p className={styles.kucuk}>{t("dao.hata.once_cek")} {t("dao.karar.sonraki_hafta")}</p> : null}
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" disabled={k.kapali || oranHata !== null || gecis} onClick={() => void k.gonder({ tur: "mevduat", lonca: lonca === "" ? null : lonca, oran: oranSayi / 100 })}>
          {t("dao.karar.mevduat_kaydet")}
        </Button>
      </div>
    </section>
  );
}

/** Meydanda para çekme: loncadaki mevduattan nakde. */
export function ParaCekEylemi({ k }: { k: KararDurumu }) {
  const uid = useId();
  const [miktar, setMiktar] = useState("");
  const miktarSayi = parseNumber(miktar);
  const miktarHata = miktar.trim() === "" || (Number.isFinite(miktarSayi) && miktarSayi > 0) ? null : t("dao.karar.miktar_gecersiz");
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-cek`}>
      <h3 id={`${uid}-cek`} className={styles.altBaslik}>{t("dao.karar.cek")}</h3>
      <Field
        kind="input" id={`${uid}-miktar`} label={t("dao.karar.miktar")} type="text" inputMode="decimal" suffix={t("dao.birim.akce")} value={miktar} disabled={k.kapali}
        onChange={(e) => setMiktar(e.target.value)} {...(miktarHata ? { error: miktarHata } : {})}
      />
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" disabled={k.kapali || miktar.trim() === "" || miktarHata !== null} onClick={() => void k.gonder({ tur: "cek", miktar: miktarSayi })}>
          {t("dao.karar.cek_dugme")}
        </Button>
      </div>
    </section>
  );
}

/** İşletme kartında: sahibin nakdinden işletme kasasına sermaye aktarımı (transfer). */
export function SermayeEkleEylemi({ k }: { k: KararDurumu }) {
  const uid = useId();
  const [miktar, setMiktar] = useState("");
  const miktarSayi = parseNumber(miktar);
  const miktarHata = miktar.trim() === "" || (Number.isFinite(miktarSayi) && miktarSayi > 0) ? null : t("dao.karar.miktar_gecersiz");
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-sermaye`}>
      <h3 id={`${uid}-sermaye`} className={styles.altBaslik}>{t("dao.karar.sermaye_ekle")}</h3>
      <Field
        kind="input" id={`${uid}-miktar`} label={t("dao.karar.miktar")} type="text" inputMode="decimal" suffix={t("dao.birim.akce")} value={miktar} disabled={k.kapali}
        onChange={(e) => setMiktar(e.target.value)} {...(miktarHata ? { error: miktarHata } : {})}
      />
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" disabled={k.kapali || miktar.trim() === "" || miktarHata !== null} onClick={() => void k.gonder({ tur: "sermaye_ekle", miktar: miktarSayi })}>
          {t("dao.karar.sermaye_ekle_dugme")}
        </Button>
      </div>
    </section>
  );
}

/**
 * İşletme kartında (HUMAN_LONCA): işletmenin loncasını seç / değiştir. Liste botun kullandığı skora göre sıralıdır (düşük = elverişli; skoru olmayanlar sonda).
 * Düğme yalnız `lonca_degisebilir` iken etkindir. Sunucu eskiyse (`firmam.lonca` yok) bileşen görünmez.
 */
export function LoncaSecEylemi({ g, k }: { g: DaoGozlem; k: KararDurumu }) {
  const uid = useId();
  const f = g.firmam;
  const [secim, setSecim] = useState<string | null>(null);
  if (f === null || f.lonca === undefined) return null;
  const mevcut = f.lonca;
  const aday = g.loncalar
    .filter((l) => !l.kapali && l.ad !== mevcut)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.skor ?? Infinity) - (b.l.skor ?? Infinity) || a.i - b.i)
    .map((x) => x.l);
  // Seçici kullanıcının seçimini tutar; aday listesi değişince geçersiz kalan seçim yerine en elverişli lonca geçer, bayat değer gönderilmez.
  const lonca = secim !== null && aday.some((l) => l.ad === secim) ? secim : (aday[0]?.ad ?? "");
  const sirada = k.sirada?.tur === "lonca_sec" ? k.sirada : null;
  const degisebilir = f.lonca_degisebilir === true && lonca !== "";
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-lonca`}>
      <h3 id={`${uid}-lonca`} className={styles.altBaslik}>{t("dao.karar.lonca_sec")}</h3>
      <p className={styles.kucuk}>{t("dao.karar.lonca_sec_simdi", { lonca: loncaAdi(mevcut) })}</p>
      <p className={styles.kucuk}>{t("dao.karar.lonca_sec_aciklama")}</p>
      <Field kind="select" id={`${uid}-sec`} label={t("dao.karar.lonca")} value={lonca} disabled={k.kapali || !degisebilir || sirada !== null} onChange={(e) => setSecim(e.target.value)}>
        {aday.map((l) => (
          <option key={l.ad} value={l.ad}>
            {t("dao.karar.lonca_sec_secenek", {
              lonca: loncaAdi(l.ad), pay: l.pay_orani == null ? "–" : pct(l.pay_orani, 2),
              kredi: t(l.kredi_verebilir ? "dao.karar.lonca_sec_kredi_var" : "dao.karar.lonca_sec_kredi_yok"), skor: l.skor == null ? "–" : l.skor.toFixed(3),
            })}
          </option>
        ))}
      </Field>
      {f.lonca_degisebilir !== true ? <p className={styles.kucuk}>{(f.lonca_erken_hafta ?? 0) > 0 ? t("dao.karar.lonca_sec_erken", { hafta: f.lonca_erken_hafta ?? 0 }) : t("dao.karar.lonca_sec_bekleme")}</p> : null}
      {sirada !== null ? <p className={styles.kucuk} role="status">{t("dao.sirada.hafta", { hafta: sirada.hafta })}</p> : null}
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" disabled={k.kapali || !degisebilir || sirada !== null} onClick={() => void k.gonder({ tur: "lonca_sec", lonca })}>
          {t("dao.karar.lonca_sec_dugme")}
        </Button>
      </div>
    </section>
  );
}

/**
 * İşletme kartında (HUMAN_LONCA): lonca kur. Şartlar gözlemdeki `lonca_kur` listesidir (botla aynı fonksiyon); eksik varken düğme pasiftir ve eksikler sayılır.
 * Kazanç karşılaştırması yok: kuruluş kararı oyuncunundur. Sunucu eskiyse (`lonca_kur` yok) bileşen görünmez.
 */
export function LoncaKurEylemi({ g, k }: { g: DaoGozlem; k: KararDurumu }) {
  const uid = useId();
  const lk = g.lonca_kur;
  const [secim, setSecim] = useState<DaoLoncaKurYol | null>(null);
  if (lk === undefined) return null;
  // Kullanıcı seçmediyse kurulabilir ilk yol (yoksa ilki) gösterilir.
  const yol: DaoLoncaKurYol = secim ?? DAO_LONCA_KUR_YOLLARI.find((y) => (lk[y] ?? []).length === 0) ?? "girisimci";
  const eksik = lk[yol] ?? [];
  const ayr = g.lonca_kur_ayrinti?.[yol] ?? [];
  const sirada = k.sirada?.tur === "lonca_kur" ? k.sirada : null;
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-lkur`}>
      <h3 id={`${uid}-lkur`} className={styles.altBaslik}>{t("dao.karar.lonca_kur")}</h3>
      <p className={styles.kucuk}>{t("dao.karar.lonca_kur_aciklama")}</p>
      <Field kind="select" id={`${uid}-yol`} label={t("dao.karar.lonca_kur_yol")} value={yol} disabled={k.kapali || sirada !== null} onChange={(e) => setSecim(e.target.value as DaoLoncaKurYol)}>
        {DAO_LONCA_KUR_YOLLARI.map((y) => (
          <option key={y} value={y}>{t(`dao.karar.lonca_kur_yol.${y}`)}</option>
        ))}
      </Field>
      {eksik.length > 0 ? (
        <>
          <p className={styles.kucuk}>{t("dao.karar.lonca_kur_eksikler")}</p>
          <ul className={styles.kucuk}>
            {eksik.map((id) => <li key={id}>{loncaKurEksikMetni(id, ayr.find((a) => a.id === id))}</li>)}
          </ul>
        </>
      ) : (
        <p className={styles.kucuk}>{t("dao.karar.lonca_kur_hazir")}</p>
      )}
      {sirada !== null ? <p className={styles.kucuk} role="status">{t("dao.sirada.hafta", { hafta: sirada.hafta })}</p> : null}
      <div className={styles.dugmeler}>
        <Button variant="secondary" size="sm" disabled={k.kapali || eksik.length > 0 || sirada !== null} onClick={() => void k.gonder({ tur: "lonca_kur", yol })}>
          {t("dao.karar.lonca_kur_dugme")}
        </Button>
      </div>
    </section>
  );
}
