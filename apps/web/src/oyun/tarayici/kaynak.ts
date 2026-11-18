/**
 * B5: tarayici kaynaginin acilisi. Siralama: Worker + Pyodide yukleme -> IndexedDB kayit katmani -> (varsa) kayittan devam -> tick dongusu.
 * `OyunApp.chooseSource` bunu `NEXT_PUBLIC_OYUN_KAYNAK=tarayici` iken cagirir; sonuc `LiveSource`a `fetchImpl`/`eventSourceImpl` olarak verilir.
 * B8: devam edilemeyen kayitlar icin secim ekrani (baştan oynat + tahmini sure, disa aktar, sil, yeni oyun) ve tariften oynatmada ilerleme/iptal.
 */
import type { AkisSonucu } from "./kayit/akis";
import type { SureTahmini } from "./kayit/siniflandirma";
import { kayitHizmetleri, kosuTuru, type KayitHizmetleri } from "./hizmetler";
import { acilisKarari, acilisSecimi } from "./acilisEslemesi";
import { KayitDeposu, kayitKatmaniAc, type KayitKatmani } from "./kayit/index";
import type { KosuKaydi } from "./kayit/depo";
import type { DepolamaArayuzu } from "./kayit/kota";
import { kayitCekirdegi } from "./kayitCekirdegi";
import { olcumKopru } from "./olcumKancasi";
import { TarayiciKopru, type Uyari } from "./kopru";
import { gercekSekmeOrtami, sekmeKilidiAl, type SekmeOrtami, type Tutulan } from "./sekmeKilidi";
import { OyunYukleyici, type IsciIstemcisi, type WorkerBaglantisi, type YuklemeIlerlemesi } from "./yukleyici";
import { YuklemeHatasi } from "./protokol";
import { rotaPaketKarari } from "./rotaPaket";

/** Yukleme ekraninin gosterdigi durum. */
export type AcilisDurumu =
  | ({ tur: "yukleme" } & YuklemeIlerlemesi)
  /** `tahmini`/`uzun`: devam oncesi sure bilgisi (`uzun` = birkac dakika surebilir); `iptal`: kayit silinmeden sayfa yeniden yuklenir, acilis secimine donulur. */
  | { tur: "devam"; hafta: number; hedef: number | null; tahmini?: SureTahmini; uzun?: boolean; kaynak?: "goruntu" | "tarif"; iptal?(): void }
  | { tur: "secim"; kosuId: string; hafta: number; devam(): void; yeni(): void }
  /** Kayit acilamadi (`sonuc` = uyumsuz / tariften_gerek / durdu / hata): secenekler `acilisSecimi(sonuc)`'dan; her geri cagri her zaman vardir, arayuz yalniz sunulanlari cagirir. */
  | {
      tur: "devam_olmadi";
      sonuc: Exclude<AkisSonucu, { sonuc: "tamam" }>;
      kosuId: string;
      yeni(): void;
      tariftenOynat(): void;
      yenidenYukle(): void;
      disaAktar(): Promise<{ ad: string; metin: string }>;
      /** Kaydi siler ve yeni oyuna gecer; silinemezse reddeder (ekran kalir). */
      sil(): Promise<void>;
    }
  /** Kayit baska bir model paketiyle yazilmis: sayfa dogru surumle yeniden yukleniyor (notr bekleme; yenileme olmazsa `devam_olmadi`ya duser). */
  | { tur: "surum_yukleniyor"; /** Yenileme nedeni: model surumu farki (varsayilan) ya da kayit acma/secim. */ neden?: "surum" | "acma" }
  /** Oyun baska sekmede acik: Worker baslatilmadi; `devral()` o sekmeyi kapatip bu sekmede surdurur. */
  | { tur: "baska_sekme"; devral(): void };

export interface KaynakSecenek {
  workerUret(): WorkerBaglantisi;
  origin: string;
  idb: IDBFactory;
  storage?: DepolamaArayuzu | null;
  /** `location.hash` (ornek `#/canli/canli-ab12`). */
  hash: string;
  /** Hash'i degistirir (devam edilen kosunun rotasi). */
  hashYaz(hash: string): void;
  durum(d: AcilisDurumu): void;
  hata?: (kaynak: string, e: unknown) => void;
  /** Worker dustu / yanit vermiyor: kayit guvende, yeniden yukleyince devam eder. */
  dustu?: (e: unknown) => void;
  /** Kalicilik durumu (kayit acilamadi / hafta yazilamiyor / duzeldi). */
  uyari?: (u: Uyari) => void;
  /** Baska bir sekme oyunu devraldi: bu sekmenin motoru kapatildi. */
  baskaSekme?: () => void;
  /** Test icin: Web Locks / BroadcastChannel ortami. */
  sekme?: SekmeOrtami;
  hatirlatma?: (o: { kosuId: string; hafta: number }) => void;
  /** Iptal (bilesen kalkti): yukleme sonlandirilir. */
  iptalEdildi?: () => boolean;
  /**
   * B7: manifest sorgusu (Service Worker `?model=` yolu). Verilmezse model secimi yapilmaz: her zaman guncel paket (eski davranis).
   * Kayitli oyunun modeli guncelden farkliysa ve SW o modelin onceki paketini tutuyorsa oyun O PAKETLE acilir; yeni oyun her zaman guncel paketle.
   */
  fetch?: (girdi: string) => Promise<Response>;
  /** B7: eski paketle acilmis oturumda yeni oyun istenince cagrilir (sayfa guncel paketle yeniden yuklenmeli). */
  yeniOyunIcinYenile?: () => void;
  /** B7 R3-1: kayitli kosu yuklu paketle acilamaz (`yeniden_yukle_gerek`): kayit tamamlanip AYNI rota ile yeniden yuklenir (hash o kosunun rotasinda). */
  kayitIcinYenile?: (kosuId: string) => void;
  /** B8 K1: Koşular/`#/sonuc`/`#/dao` yolundan acilan kayit secim ekrani gerektiriyor: hash o kosunun rotasina yazilip kayit tamamlanarak sayfa yeniden yuklenmeli. */
  kayitSecimiIcin?: (kosuId: string) => void | Promise<boolean>;
  /** B8: sayfayi yeniden yukler (tariften oynatma iptali, "yeniden yukle" secenegi). */
  yenile?: () => void;
  /** B8: `yeniden_yukle_gerek` sonrasi yenilemenin gerceklesmesi icin beklenen sure (ms); asilirsa secim ekrani acilir. Varsayilan 8000. */
  yenilemeBeklemeMs?: number;
}

export interface TarayiciKaynagi {
  kopru: TarayiciKopru;
  kayit: KayitKatmani;
  isci: IsciIstemcisi;
  /** Worker'i sonlandirir, dongu durur. */
  kapat(): Promise<void>;
  /**
   * B7: yeni surum uygulamasindan once: hafta dongusu durur, bekleyen yazimlar yazilir. `false` = kalici yazim tamamlanamadi (uygulama YAPILMAMALI;
   * cagiran `surdur()` ile donguyu yeniden baslatir).
   */
  kayitTamamla(): Promise<boolean>;
  surdur(): void;
  /** B7: kayit (varsa) yuklu paketten FARKLI modelle yazilmis mi (eski paketli oturumda baska kosuya gecis: sayfa yeniden yuklenmeli). */
  kosuUyumsuz(kosuId: string): Promise<boolean>;
  /** B7: oturum guncel olmayan (onceki) model paketiyle acildi: yeni oyun icin sayfa yeniden yuklenmeli. */
  eskiPaket: boolean;
  /** B8: arayuzun kayit hizmetleri (depolama, kayitli oyunlar, disa/ice aktarma, silme). */
  hizmetler: KayitHizmetleri;
}

const CANLI = "#/canli/";
/** Koşunun ev rotası: DAO koşusu #/dao/, diğerleri #/canli/ (OyunApp.kayitAc ile aynı kural). */
const kosuRotasi = (k: KosuKaydi): string => (kosuTuru(k) === "dao" ? "#/dao/" : CANLI);
const IPTAL_YOKLAMA_MS = 200;

/** Hash'in koşu kimligi: yalniz `#/canli/<id>[/<gorunum>]`. */
export function hashKosuKimligi(hash: string): string | null {
  // `#/canli/<id>`, `#/sonuc/<id>`, `#/dao/<id>[/<sehir>]` (paylasilan dunya `#/dao/d/<kod>` koşu degildir).
  const onek = [CANLI, "#/sonuc/", "#/dao/"].find((o) => hash.startsWith(o));
  if (onek === undefined || hash.length === onek.length) return null;
  if (onek === "#/dao/" && (hash.startsWith("#/dao/d/") || hash === "#/dao/d")) return null;
  const rest = hash.slice(onek.length);
  const kes = rest.indexOf("/");
  return kes > 0 ? rest.slice(0, kes) : rest;
}

/** Baslangic/Kosular rotalari: kayitli oyun varsa "devam mi, yeni mi" sorulur. */
function evRotasi(hash: string): boolean {
  return hash === "" || hash === "#" || hash === "#/" || hash === "#/kosular";
}

function enSon(kosular: readonly KosuKaydi[]): KosuKaydi | null {
  const adaylar = kosular.filter((k) => k.yayimlanan > 0);
  adaylar.sort((a, b) => b.guncelleme - a.guncelleme);
  return adaylar[0] ?? null;
}

/** Bekleyen bir is sirasinda bilesen kalkarsa (`iptalEdildi`) bekleyis `iptal_edildi` ile biter; cagiran Worker'i kapatir. */
function iptalYarisi<T>(p: Promise<T>, iptal: () => boolean): Promise<T> {
  return new Promise<T>((coz, reddet) => {
    const t = setInterval(() => {
      if (iptal()) {
        clearInterval(t);
        reddet(new YuklemeHatasi("iptal_edildi"));
      }
    }, IPTAL_YOKLAMA_MS);
    p.then(
      (v) => (clearInterval(t), coz(v)),
      (e) => (clearInterval(t), reddet(e)),
    );
  });
}

interface ModelSecimi {
  /** Yukleyiciye verilecek model (`null` = guncel paket). */
  model: string | null;
  /** Ev rotasinda "devam mi, yeni mi" yukleme ONCESI soruldu: devam akisi tekrar sormaz. `hedef: null` = yeni oyun secildi. */
  onceden: { hedef: KosuKaydi | null } | null;
}

async function manifestModeli(f: (girdi: string) => Promise<Response>, url: string): Promise<string | null> {
  try {
    const r = await f(url);
    if (!r.ok) return null;
    const j = (await r.json()) as { model_sha256?: unknown } | null;
    return typeof j?.model_sha256 === "string" ? j.model_sha256 : null;
  } catch {
    return null;
  }
}

/**
 * B7: yukleme ONCESI. Devam edilecek kosunun modeli guncel manifestinkinden FARKLIYSA ve Service Worker o modelin onceki paketini tutuyorsa
 * (`?model=<sha>` ayni modeli doner) oyun o paketle acilir. Ev rotasinda hangi kosunun hedef oldugu kullaniciya SORULMADAN bilinemez: bu durumda
 * soru yukleme oncesine alinir ("yeni" secilirse guncel paket). Diger her durumda (SW yok, model ayni, paket tutulmuyor) davranis degismez.
 */
async function modelSecimi(o: KaynakSecenek, iptal: () => boolean): Promise<ModelSecimi> {
  const bos: ModelSecimi = { model: null, onceden: null };
  const f = o.fetch;
  if (!f) return bos;
  const karar = rotaPaketKarari(o.hash);
  if (karar.tur !== "kosu" && karar.tur !== "ev") return bos;
  const hashId = karar.tur === "kosu" ? karar.kosuId : null;
  let kosular: KosuKaydi[];
  try {
    const depo = await KayitDeposu.ac(o.idb);
    try {
      kosular = await depo.kosulariListele();
    } finally {
      depo.kapat();
    }
  } catch {
    return bos; // depo acilamiyorsa kayit katmani kendi hatasini verir
  }
  const hedef = hashId !== null ? (kosular.find((k) => k.kosuId === hashId) ?? null) : enSon(kosular);
  if (hedef === null) return bos;
  const istenen = hedef.modelAnahtari.model_sha256;
  const kok = `${o.origin}/oyun/manifest.json`;
  const [guncel, eslesen] = await Promise.all([manifestModeli(f, kok), manifestModeli(f, `${kok}?model=${encodeURIComponent(istenen)}`)]);
  if (guncel === null || guncel === istenen || eslesen !== istenen) return bos;
  if (hashId !== null) return { model: istenen, onceden: null };
  const secim = await iptalYarisi(new Promise<"devam" | "yeni">((coz) => o.durum({ tur: "secim", kosuId: hedef.kosuId, hafta: hedef.yayimlanan, devam: () => coz("devam"), yeni: () => coz("yeni") })), iptal);
  return secim === "devam" ? { model: istenen, onceden: { hedef } } : { model: null, onceden: { hedef: null } };
}

export async function tarayiciKaynagiKur(o: KaynakSecenek): Promise<TarayiciKaynagi> {
  // Durum: kilit alinir alinmaz devir dinleyicisi baglanir (yukleme, secim ekrani, uzun yeniden oynatma sirasinda da devir dogru isler).
  let devredilen = false;
  let bitti = false;
  let devirSozu: Promise<void> | null = null;
  let isci: IsciIstemcisi | null = null;
  let kopru: TarayiciKopru | null = null;
  let kayit: KayitKatmani | null = null;
  let tutulan: Tutulan | null = null;
  const iptal = (): boolean => o.iptalEdildi?.() === true || devredilen;

  /**
   * Devir (baska sekme devraliyor) ya da kilit calindi. Sira: (zarif degilse once IndexedDB yazimi kapanir) -> Worker HEMEN sonlandirilir (suren tick
   * beklenmez; haftalar belirlenimli, yeni sekme yeniden hesaplar) -> elde kalan yazilmamis haftalar/gunluk yazilir -> IndexedDB kapanir -> kilit birakilir.
   * Boylece hicbir an iki yazar yoktur.
   */
  const devirIsle = (zarif: boolean): Promise<void> => {
    if (bitti) return Promise.resolve();
    if (devirSozu) return devirSozu;
    devredilen = true;
    devirSozu = (async () => {
      if (!zarif) kayit?.depo.kapat();                      // kilit calindi: bu sekmede tum yazim hemen kapanir
      const dur = kopru?.durdur();
      isci?.kapat();
      await dur;
      if (zarif) await kopru?.bosalt().catch(() => undefined);
      if (zarif) await kopru?.bekleyenleriYaz().catch(() => undefined);
      kayit?.depo.kapat();
      bitti = true;
      tutulan?.birak();
      o.baskaSekme?.();
    })();
    return devirSozu;
  };

  // 1) Tek sekme: Pyodide indirilmeden ONCE kilit. Doluysa Worker baslamaz, kullaniciya sorulur.
  const sekme = o.sekme ?? gercekSekmeOrtami();
  const kilit = await sekmeKilidiAl(sekme);
  if (kilit.durum === "dolu") {
    await iptalYarisi(new Promise<void>((coz) => o.durum({ tur: "baska_sekme", devral: () => coz() })), iptal);
    tutulan = await kilit.devral();
  } else tutulan = kilit;
  tutulan.devirDinle(() => devirIsle(true));
  // Kilit calindi (zarif devir 20 sn'yi asmis olsa bile): IndexedDB ONCE, kosulsuz kapanir; sonra geri kalan kapanis.
  void tutulan.devredildi.then(() => {
    if (bitti) return undefined;
    kayit?.depo.kapat();
    return devirIsle(false);
  });
  const kilitTut = tutulan;

  let modelSec: ModelSecimi;
  try {
    modelSec = await modelSecimi(o, iptal);
  } catch (e) {
    if (!devredilen) kilitTut.birak();
    throw e;
  }

  const yukleyici = new OyunYukleyici({
    workerUret: o.workerUret,
    origin: o.origin,
    model: modelSec.model ?? undefined,
    ilerleme: (i) => o.durum({ tur: "yukleme", ...i }),
    dustu: o.dustu,
  });
  const bekci = setInterval(() => {
    if (iptal()) yukleyici.iptal();
  }, IPTAL_YOKLAMA_MS);
  try {
    isci = (await yukleyici.bitti).istemci;
    // Olcum notu (B9/e2e): asama sureleri `performance` isaretinde.
    if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark("oyun-tarayici-hazir", { detail: isci.bilgi.sureler });
  } catch (e) {
    if (!devredilen) kilitTut.birak();
    throw e;
  } finally {
    clearInterval(bekci);
  }
  const calisanIsci = isci;
  try {
    if (iptal()) throw new YuklemeHatasi("iptal_edildi");
    o.durum({ tur: "yukleme", asama: "kayit", oran: null });
    kayit = await kayitKatmaniAc({
      idb: o.idb,
      cekirdek: kayitCekirdegi(calisanIsci),
      storage: o.storage ?? null,
      hatirlatma: o.hatirlatma,
      guncelModel: o.fetch ? () => manifestModeli(o.fetch as (g: string) => Promise<Response>, `${o.origin}/oyun/manifest.json`) : undefined,
    });
    const k = kayit;
    if (iptal()) {
      k.depo.kapat();
      throw new YuklemeHatasi("iptal_edildi");
    }
    void k.kota.kalicilikIste().catch(() => undefined);
    // Olculen hiz onceki oturumdan cekirdege verilir: `/api/hello` ilk tick'ten once de dogru deger doner.
    const p50 = await k.depo.metaOku<number>("p50").catch(() => null);
    if (typeof p50 === "number" && p50 > 0) await calisanIsci.cagri("p50", { sn: p50 }).catch(() => undefined);
    kopru = new TarayiciKopru({ isci: calisanIsci, kayit: k, hata: o.hata, dustu: o.dustu, uyari: o.uyari, eskiPaket: modelSec.model !== null, yeniOyunIcinYenile: o.yeniOyunIcinYenile, kayitIcinYenile: o.kayitIcinYenile, kayitSecimiIcin: o.kayitSecimiIcin });
    const kp = kopru;
    olcumKopru(kp);

    const hizmetler = kayitHizmetleri(k, { sil: (id) => kp.kosuSil(id), aktifler: () => kp.takipEdilenler() });
    await iptalYarisi(devamAkisi(o, k, kp, hizmetler, modelSec.onceden), iptal);
    if (iptal()) throw new YuklemeHatasi("iptal_edildi");
    kp.baslat();

    const kapat = async (): Promise<void> => {
      if (bitti) return;
      const ds = devirSozu as Promise<void> | null;
      if (ds) return ds;
      bitti = true;
      // Devir yolundaki sira: durdur (bayrak) + Worker'i HEMEN kapat (uzun cagri beklenmez), sonra bekle ve yazimlari bitir.
      const dur = kp.durdur();
      calisanIsci.kapat();
      await dur;
      await kp.bosalt().catch(() => undefined);
      k.depo.kapat();
      kilitTut.birak();
    };
    const kayitTamamla = async (): Promise<boolean> => (bitti || devredilen ? false : kp.kayitTamamla());
    const surdur = (): void => {
      if (!bitti && !devredilen) kp.baslat();
    };
    const kosuUyumsuz = async (kosuId: string): Promise<boolean> => {
      const kayitli = await k.depo.kosuOku(kosuId).catch(() => null);
      return kayitli !== null && kayitli.modelAnahtari.model_sha256 !== calisanIsci.bilgi.anahtar.model_sha256;
    };
    return { kopru: kp, kayit: k, isci: calisanIsci, kapat, kayitTamamla, surdur, kosuUyumsuz, eskiPaket: modelSec.model !== null, hizmetler };
  } catch (e) {
    calisanIsci.kapat();
    kayit?.depo.kapat();                           // iptal/hata/devir: acik IndexedDB baglantisi kalmaz; askidaki devamAkisi yazamaz
    const ds = devirSozu as Promise<void> | null;
    if (ds) await ds.catch(() => undefined);
    else {
      bitti = true;
      kilitTut.birak();
    }
    throw e;
  }
}

/** Bu tahmini (en cok, sn) asilirsa arayuz "birkac dakika surebilir" uyarisi gosterir. */
const UZUN_SN = 90;
const YENILEME_BEKLEME_MS = 8000;

type Secim = "yeni" | "tariften" | "yenile";

/** Hash bir kayitli kosuyu gosteriyorsa onu, ev rotasindaysa ve kayit varsa kullaniciya sorarak devam ettirir. */
async function devamAkisi(o: KaynakSecenek, kayit: KayitKatmani, kopru: TarayiciKopru, hizmetler: KayitHizmetleri, onceden: ModelSecimi["onceden"] = null): Promise<void> {
  const kosular = await kayit.depo.kosulariListele();
  const hashId = hashKosuKimligi(o.hash);
  let hedef: KosuKaydi | null = null;
  if (onceden !== null) hedef = onceden.hedef === null ? null : (kosular.find((k) => k.kosuId === onceden.hedef?.kosuId) ?? null);
  else if (hashId !== null) hedef = kosular.find((k) => k.kosuId === hashId) ?? null;
  else if (evRotasi(o.hash)) {
    const son = enSon(kosular);
    if (son !== null) {
      const secim = await new Promise<"devam" | "yeni">((coz) => o.durum({ tur: "secim", kosuId: son.kosuId, hafta: son.yayimlanan, devam: () => coz("devam"), yeni: () => coz("yeni") }));
      if (secim === "devam") hedef = son;
    }
  }
  if (hedef === null) return;

  const kosuId = hedef.kosuId;
  const hedefHafta = hedef.yayimlanan;
  // Iptal: kayit SILINMEZ; hash eve doner ve sayfa yeniden yuklenir (acilis secimi tekrar sorulur; aksi halde ayni rota ayni oynatmayi yeniden baslatirdi).
  const iptal = (): void => {
    o.hashYaz("#/");
    o.yenile?.();
  };
  const onizleme = await kayit.akis.devamOnizleme(kosuId).catch(() => null);
  const bilgi = (tahmini: SureTahmini | undefined, genisletilmis: boolean, kaynak: "goruntu" | "tarif"): { tahmini?: SureTahmini; uzun: boolean; kaynak: "goruntu" | "tarif" } => ({ ...(tahmini ? { tahmini } : {}), uzun: genisletilmis || (tahmini?.enCokSn ?? 0) >= UZUN_SN, kaynak });
  const ilerlemeDurumu = (tahmini: SureTahmini | undefined, genisletilmis: boolean, kaynak: "goruntu" | "tarif") => (hafta: number): void => o.durum({ tur: "devam", hafta, hedef: hedefHafta, ...bilgi(tahmini, genisletilmis, kaynak), iptal });
  const ilk = ilerlemeDurumu(onizleme?.tahmini, onizleme?.genisletilmis ?? false, onizleme?.kaynak ?? "tarif");
  ilk(0);
  let sonuc = await kayit.akis.devamEt(kosuId, { ilerleme: ilk });

  let rotaYazildi = false;
  let yenilemeDenendi = false;
  for (;;) {
    if (sonuc.sonuc === "tamam") {
      await kopru.takipEt(sonuc.kosuId);
      if (hashId === null) o.hashYaz(`${kosuRotasi(hedef)}${sonuc.kosuId}`);
      return;
    }
    // TEK karar tablosu (`acilisKarari`, kayittanAc ile ortak): kisa goruntusuz kayit AYNI modelde sormadan baştan oynatilir; digerleri (model farkli dahil) secim ekrani.
    if (sonuc.sonuc === "tariften_gerek" && !yenilemeDenendi && (await kayit.akis.yenidenYuklemeGerekli(kosuId).catch(() => false))) sonuc = { sonuc: "hata", tur: "yeniden_yukle_gerek", mesaj: "yeniden_yukle_gerek" };
    const uyum = await kayit.akis.uyumlulukDurumu(kosuId).catch(() => null);
    const karar = sonuc.sonuc === "tariften_gerek" ? acilisKarari(sonuc, { uyumlu: uyum?.uyumlu ?? true, ...(uyum ? { fark: uyum.fark } : {}) }) : null;
    if (karar?.tur === "otomatik" && sonuc.sonuc === "tariften_gerek") {
      const f = ilerlemeDurumu(sonuc.tahmini, false, "tarif");
      f(0);
      sonuc = await kayit.akis.tariftenBastan(kosuId, { ilerleme: f });
      continue;
    }
    if (karar?.tur === "secim") sonuc = karar.sonuc;
    if (sonuc.sonuc === "hata" && sonuc.tur === "yeniden_yukle_gerek" && !yenilemeDenendi) {
      yenilemeDenendi = true;
      // Kayit yuklu paketten farkli modelde: asagi yazmak yerine yeniden yuklenir. Hash once kosunun rotasina yazilir (ev rotasindan devam secildiyse),
      // yenilemeden sonra `modelSecimi` o kosunun paketini secer. Yenileme beklenirken notr bir "dogru surum yukleniyor" durumu gosterilir.
      if (hashId === null) {
        o.hashYaz(`${kosuRotasi(hedef)}${kosuId}`);
        rotaYazildi = true;
      }
      o.kayitIcinYenile?.(kosuId);
      o.durum({ tur: "surum_yukleniyor" });
      await new Promise<void>((coz) => setTimeout(coz, o.yenilemeBeklemeMs ?? YENILEME_BEKLEME_MS));
    }
    const gosterilecek = sonuc as Exclude<typeof sonuc, { sonuc: "tamam" }>;
    const secim = await new Promise<Secim>((coz) => {
      o.durum({
        tur: "devam_olmadi",
        sonuc: gosterilecek,
        kosuId,
        yeni: () => coz("yeni"),
        tariftenOynat: () => coz("tariften"),
        yenidenYukle: () => {
          o.yenile?.();
          coz("yenile");
        },
        disaAktar: () => hizmetler.disaAktar(kosuId),
        sil: async () => {
          await hizmetler.sil(kosuId);
          coz("yeni");
        },
      });
    });
    if (secim === "yeni") {
      if (hashId !== null || rotaYazildi) o.hashYaz("#/");
      return;
    }
    if (secim === "yenile") return new Promise<void>(() => undefined); // sayfa yenileniyor: akis bitmez
    const tahmini = acilisSecimi(gosterilecek).tahmini ?? undefined;
    const f = ilerlemeDurumu(tahmini ?? (await kayit.akis.devamOnizleme(kosuId).catch(() => null))?.tahmini, false, "tarif");
    f(0);
    sonuc = await kayit.akis.tariftenBastan(kosuId, { ilerleme: f });
  }
}
