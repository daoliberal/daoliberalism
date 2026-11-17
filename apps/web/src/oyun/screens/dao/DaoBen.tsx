import { Button } from "@/components/primitives/Button";
import { Badge } from "@/components/primitives/Badge";
import { DefinitionList } from "@/components/primitives/DefinitionList";
import { t } from "@/oyun/copy/t";
import { num } from "@/oyun/lib/format";
import { batisMetni, daoDurumMetni, daoUnvanMetni, tecrubeSaymaz, terfiIlerlemesi, uyariMetni, type DaoAdlar, type DaoGozlem } from "@/oyun/sim/dao";
import { loncaAdi } from "@/oyun/screens/canli/LoncaTablosu";
import styles from "./DaoEkrani.module.css";

const ondalik = (x: number): string => x.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const akce = (x: number): string => t("canli.gosterge.akce", { n: num(x) });

/** Ben paneli: durum, unvan, nakit, mevduat, iş; işletme kurmaya doğru ilerleme; varsa işletmem. */
export function DaoBen({ g, ad, onIlanlaraBak, onIsletmeyiGoster }: { g: DaoGozlem; ad: DaoAdlar; onIlanlaraBak?: () => void; onIsletmeyiGoster?: () => void }) {
  const b = g.ben;
  const k = g.kurabilir;
  const toplam = Math.max(1, k.gereken_hafta);
  // Her şartın doluluk oranı; çubuk en azını gösterir (bir şart eksikken çubuk dolu görünmez, "Kur" kapalıyken de dolmaz).
  const calismaOran = Math.min(b.calisilan_hafta / toplam, 1);
  const harcVar = k.harc > 0;
  const nakitOran = harcVar ? Math.min(Math.max(b.nakit, 0) / k.harc, 1) : 1;
  // Ahırdaki "iş" sayılmaz: çubukta iş 0, metin "önce ahırdan çık".
  const ahirda = b.durum === "ahir" || k.eksikler.includes("ahirda");
  const isVar = !k.eksikler.includes("issiz") && !ahirda;
  const oran = k.evet ? 1 : Math.min(calismaOran, nakitOran, isVar ? 1 : 0, k.eksikler.includes("erken") ? 0 : 1, 0.99);
  const isMetni = b.is.firma === null ? t("dao.ben.is_yok") : b.is.sektor === "ahir" ? ad.sektor("ahir") : b.is.sektor === null ? ad.firma(b.is.firma) : t("dao.ben.is_firma", { sektor: ad.sektor(b.is.sektor), sehir: ad.sehir(b.sehir) });
  const terfi = terfiIlerlemesi(b);
  return (
    <>
      <DefinitionList
        columns={2}
        items={[
          { term: t("dao.ben.durum"), detail: daoDurumMetni(b.durum) },
          { term: t("dao.ben.unvan"), detail: daoUnvanMetni(b.unvan) },
          { term: t("dao.ben.sehir"), detail: ad.sehir(b.sehir) },
          { term: t("dao.ben.nakit"), detail: akce(b.nakit) },
          { term: t("dao.ben.mevduat"), detail: b.mevduat.lonca === null || b.mevduat.tutar <= 0 ? t("dao.ben.mevduat_yok") : t("dao.ben.mevduat_lonca", { tutar: num(b.mevduat.tutar), lonca: loncaAdi(b.mevduat.lonca) }) },
          { term: t("dao.ben.is"), detail: isMetni },
          ...(b.is.firma !== null && b.durum !== "kurucu" ? [{ term: t("dao.ben.ucret"), detail: akce(b.is.ucret) }] : []),
          { term: t("dao.ben.dilim"), detail: t("dao.ben.dilim_deger", { n: b.servet_dilimi }) },
          { term: t("dao.ben.itibar"), detail: b.itibar.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) },
          { term: t("dao.ben.calisma"), detail: t("dao.ben.hafta", { n: b.calisilan_hafta }) },
        ]}
      />
      {terfi !== null ? (
        <section className={styles.bolum} aria-label={t("dao.terfi.baslik")}>
          <h3 className={styles.altBaslik}>{t("dao.terfi.baslik")}</h3>
          <p className={styles.kucuk} data-terfi={terfi.hedef}>
            {t(terfi.yaklasik ? "dao.terfi.satir_yaklasik" : "dao.terfi.satir", { unvan: daoUnvanMetni(terfi.hedef), hafta: Math.floor(Math.min(terfi.hafta, terfi.gerekenHafta)), gereken: terfi.gerekenHafta, itibar: ondalik(Math.min(terfi.itibar, terfi.gerekenItibar)), gerekenItibar: ondalik(terfi.gerekenItibar) })}
          </p>
          {terfi.tamam ? <p className={styles.kucuk}>{t("dao.terfi.tamam")}</p> : null}
          <p className={styles.kucuk}>{t("dao.terfi.kural")}</p>
          {b.is.firma !== null && tecrubeSaymaz(b.is.sektor) ? <p className={styles.uyari} role="status" data-tecrube-saymaz={b.is.sektor}>{t("dao.terfi.saymaz")}</p> : null}
        </section>
      ) : null}
      {b.durum === "kurucu" && onIsletmeyiGoster ? (
        <div className={styles.dugmeler}>
          <Button variant="primary" size="sm" onClick={onIsletmeyiGoster}>{t("dao.karar.isletmeni_goster")}</Button>
        </div>
      ) : null}
      {b.durum === "is_arayan" && onIlanlaraBak ? (
        <section className={styles.bolum} aria-label={t("dao.ben.ilanlara_bak")}>
          <p className={styles.kucuk}>{t("dao.ben.ilan_ipucu")}</p>
          <div className={styles.dugmeler}>
            <Button variant="primary" size="sm" onClick={onIlanlaraBak}>{t("dao.ben.ilanlara_bak")}</Button>
          </div>
        </section>
      ) : null}
      {b.durum !== "kurucu" ? (
        <section className={styles.bolum} aria-label={t("dao.ilerleme.baslik")}>
          <h3 className={styles.altBaslik}>{t("dao.ilerleme.baslik")}</h3>
          <progress className={styles.ilerleme} max={1} value={oran} aria-label={t("dao.ilerleme.etiket")} />
          {k.evet ? <p className={styles.kucuk}>{t("dao.ilerleme.hazir")}</p> : null}
          <ul className={styles.liste}>
            <li>{t("dao.ilerleme.calisma", { n: Math.min(b.calisilan_hafta, toplam), toplam })}</li>
            {harcVar ? <li>{t("dao.ilerleme.nakit", { n: num(b.nakit), harc: num(k.harc) })}</li> : null}
            <li>{t(isVar ? "dao.ilerleme.is_var" : ahirda ? "dao.ilerleme.is_ahir" : "dao.ilerleme.is_yok")}</li>
          </ul>
        </section>
      ) : null}
      {g.firmam !== null ? (
        <section className={styles.bolum} aria-label={t("dao.firmam.baslik")}>
          <h3 className={styles.altBaslik}>{t("dao.firmam.baslik")}</h3>
          <DefinitionList
            columns={2}
            items={[
              { term: t("dao.firmam.ad"), detail: ad.firma(g.firmam.ad, g.firmam.sektor) },
              { term: t("dao.piyasa.sektor"), detail: ad.sektor(g.firmam.sektor) },
              { term: t("dao.firmam.nakit"), detail: akce(g.firmam.nakit) },
              { term: t("dao.firmam.isci"), detail: num(g.firmam.isci) },
              { term: t("dao.firmam.kar"), detail: akce(g.firmam.kar) },
              { term: t("dao.firmam.kasa_degisim"), detail: g.firmam.kasa_degisim == null ? "—" : akce(g.firmam.kasa_degisim) },
              { term: t("dao.firmam.kasa_hafta"), detail: g.firmam.kasa_hafta == null ? "—" : t("dao.firmam.kasa_hafta_deger", { n: g.firmam.kasa_hafta.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) }) },
              { term: t("dao.firmam.yas"), detail: t("dao.ben.hafta", { n: g.firmam.yas }) },
            ]}
          />
          {g.firmam.uyari && g.firmam.uyari.length > 0 ? (
            <ul className={styles.liste} aria-label={t("dao.uyari.baslik")}>
              {g.firmam.uyari.map((kod) => (
                <li key={kod} data-isletme-uyari={kod}><Badge tone="warn" dot compact>{uyariMetni(kod, g.firmam?.kasa_pisti_hafta)}</Badge></li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {g.gecmis.firmalar.length > 0 ? (
        <section className={styles.bolum} aria-label={t("dao.isletmelerim.baslik")}>
          <h3 className={styles.altBaslik}>{t("dao.isletmelerim.baslik")}</h3>
          <ul className={styles.liste} aria-label={t("dao.isletmelerim.liste")}>
            {g.gecmis.firmalar.map((f, i) => {
              const firma = ad.firma(f.ad, f.sektor);
              const sektor = ad.sektor(f.sektor);
              return (
                <li key={`${i}-${f.ad}`} data-isletme-durum={f.ayakta ? "ayakta" : "batti"}>
                  <strong>{firma}</strong> {firma === sektor ? null : <span>{t("dao.isletmelerim.sektor", { sektor })}</span>} <span>{f.ayakta ? t("dao.isletmelerim.ayakta", { n: f.yas }) : t("dao.isletmelerim.batti", { neden: batisMetni(f), n: f.yas })}</span>
                  {!f.ayakta && f.son8_kasa_farki != null ? <span className={styles.kucuk}> {t("dao.isletmelerim.son8", { kasa: akce(f.son8_kasa_farki), ciro: akce(f.son8_ciro ?? 0), ucret: akce(f.son8_ucret ?? 0) })}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
