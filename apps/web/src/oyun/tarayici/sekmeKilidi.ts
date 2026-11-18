/**
 * B5: tek sekme koruması. Ayni oyunu iki sekme (iki Worker, ayni IndexedDB) ilerletirse paketler/gunluk karisir ve bellek iki katina cikar.
 * Veri butunlugu kilididir, yasak degil: ikinci sekme tek tikla devralabilir ("Bu sekmede devam et"), ilk sekme duzgunce kapanir.
 *
 *   1. `navigator.locks.request(AD, {ifAvailable:true})` ile omur boyu kilit (Pyodide yuklenmeden ONCE). Sekme kapaninca/coker kendiliginden birakilir.
 *   2. Alinamazsa `dolu`: Worker baslatilmaz; kullanici `devral()` derse BroadcastChannel ile ilk sekmeye "devral" gider, ilk sekme dongusunu durdurup
 *      bekleyen yazimlari bitirir, kilidi birakir ve "devredildi" yanitlar; yanit gelmezse (en cok `DEVIR_BEKLEME_MS`) `{steal:true}` ile kilit alinir
 *      (ilk sekmenin `request` sozu AbortError ile reddedilir: `devredildi` cozulur).
 *   3. `navigator.locks` yoksa BroadcastChannel yedegi ("var mi?" -> `PING_BEKLEME_MS`); o da yoksa `korumasiz` (tani icin raporlanir).
 */
export const KILIT_ADI = "daoliberal-oyun";
export const KANAL_ADI = "daoliberal-oyun";
/** Devir istegine "basladim" onayi icin beklenen sure; onay gelirse `devredildi` (bitti) icin `DEVIR_BITTI_BEKLEME_MS` beklenir. */
export const DEVIR_BEKLEME_MS = 1500;
/** Onay geldikten sonra eski sekmenin Worker'i kapatip yazilmamis haftalari/gunlugu yazmasi icin ust sinir (belirlenimli: asilirsa kilit calinir). */
export const DEVIR_BITTI_BEKLEME_MS = 20_000;
export const PING_BEKLEME_MS = 300;

export interface KilitYuzu {
  request(ad: string, secenek: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}
export interface KanalYuzu {
  postMessage(m: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}
export interface SekmeOrtami {
  locks?: KilitYuzu | null;
  kanalUret?: ((ad: string) => KanalYuzu) | null;
  bekle(ms: number): Promise<void>;
}

/** Tutulan kilit. `devredildi`: baska sekme devraldi (ya da `birak`). */
export interface Tutulan {
  devredildi: Promise<void>;
  birak(): void;
  /** Baska sekme devralmak isterken calisir (dongu durdur, yazimlari bitir, Worker kapat); bitince kilit birakilir ve karsiya bildirilir. */
  devirDinle(f: () => Promise<void>): void;
}

export type SekmeSonucu =
  | ({ durum: "alindi" } & Tutulan)
  | ({ durum: "korumasiz" } & Tutulan)
  | { durum: "dolu"; devral(): Promise<Tutulan> };

type Mesaj = { t: "ping" } | { t: "pong" } | { t: "devral" } | { t: "devir_basladi" } | { t: "devredildi" };

function mesaj(x: unknown): Mesaj | null {
  const t = (x as { t?: unknown } | null)?.t;
  return t === "ping" || t === "pong" || t === "devral" || t === "devir_basladi" || t === "devredildi" ? ({ t } as Mesaj) : null;
}

/** Kanal dinleyicisi: ping -> pong, devral -> `devir` calistir, kilidi birak, "devredildi" yay. */
function sahip(ort: SekmeOrtami, birak: () => void): { devirDinle(f: () => Promise<void>): void; kapat(): void } {
  const kanal = ort.kanalUret?.(KANAL_ADI) ?? null;
  let devir: (() => Promise<void>) | null = null;
  let devrediliyor = false;
  if (kanal) {
    kanal.onmessage = (e) => {
      const m = mesaj(e.data);
      if (m?.t === "ping") kanal.postMessage({ t: "pong" });
      else if (m?.t === "devral" && !devrediliyor) {
        devrediliyor = true;
        kanal.postMessage({ t: "devir_basladi" });          // hemen onay: karsi taraf calmaz, bitmeyi bekler
        void (async () => {
          try {
            await devir?.();
          } finally {
            birak();
            kanal.postMessage({ t: "devredildi" });
          }
        })();
      }
    };
  }
  return {
    devirDinle: (f) => {
      devir = f;
    },
    kapat: () => {
      if (kanal) kanal.onmessage = null;
      kanal?.close();
    },
  };
}

/** `navigator.locks` ile kilidi tutar (alinamazsa null). */
function kilitTut(ort: SekmeOrtami, steal: boolean): Promise<Tutulan | null> {
  const locks = ort.locks as KilitYuzu;
  return new Promise((coz) => {
    let birakKilit: () => void = () => undefined;
    let devret: () => void = () => undefined;
    const devredildi = new Promise<void>((r) => (devret = r));
    const dinleyici = sahip(ort, () => birakKilit());
    const tutulan: Tutulan = {
      devredildi,
      birak: () => {
        birakKilit();
        dinleyici.kapat();
      },
      devirDinle: dinleyici.devirDinle,
    };
    const istek = locks.request(KILIT_ADI, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (lock === null) {
        dinleyici.kapat();
        coz(null);
        return undefined;
      }
      coz(tutulan);
      return new Promise<void>((r) => (birakKilit = r));
    });
    // Normal birakma cozer, calinma AbortError ile reddeder: ikisi de "artik tutulmuyor" demektir.
    istek.then(
      () => devret(),
      () => devret(),
    );
  });
}

async function devirIste(ort: SekmeOrtami): Promise<void> {
  const kanal = ort.kanalUret?.(KANAL_ADI) ?? null;
  if (!kanal) return;
  let onay!: () => void;
  let bitti!: () => void;
  const onayVar = new Promise<void>((c) => (onay = c));
  const bittiVar = new Promise<void>((c) => (bitti = c));
  kanal.onmessage = (e) => {
    const t = mesaj(e.data)?.t;
    if (t === "devir_basladi") onay();
    else if (t === "devredildi") {
      onay();
      bitti();
    }
  };
  kanal.postMessage({ t: "devral" });
  // Onay gelmediyse (eski sekme donmus/yok) kisa beklemeden sonra kilit calinir; onay geldiyse bitmesi uzun beklenir (iki yazar olmasin).
  const onaylandi = await Promise.race([onayVar.then(() => true), ort.bekle(DEVIR_BEKLEME_MS).then(() => false)]);
  if (onaylandi) await Promise.race([bittiVar, ort.bekle(DEVIR_BITTI_BEKLEME_MS)]);
  kanal.onmessage = null;
  kanal.close();
}

/** Kanal yedegi: kimse kilit tutmaz, ping/pong ile varlik sorulur. */
async function kanalYedegi(ort: SekmeOrtami): Promise<SekmeSonucu> {
  const sor = ort.kanalUret?.(KANAL_ADI) ?? null;
  let biri = false;
  if (sor) {
    sor.onmessage = (e) => {
      if (mesaj(e.data)?.t === "pong") biri = true;
    };
    sor.postMessage({ t: "ping" });
    await ort.bekle(PING_BEKLEME_MS);
    sor.onmessage = null;
    sor.close();
  }
  const tut = (): Tutulan => {
    let devret: () => void = () => undefined;
    const devredildi = new Promise<void>((r) => (devret = r));
    const d = sahip(ort, () => devret());
    return { devredildi, birak: () => (devret(), d.kapat()), devirDinle: d.devirDinle };
  };
  if (biri) return { durum: "dolu", devral: async () => (await devirIste(ort), tut()) };
  return { durum: sor ? "alindi" : "korumasiz", ...tut() };
}

export async function sekmeKilidiAl(ort: SekmeOrtami): Promise<SekmeSonucu> {
  if (!ort.locks) return kanalYedegi(ort);
  const t = await kilitTut(ort, false);
  if (t) return { durum: "alindi", ...t };
  return {
    durum: "dolu",
    devral: async () => {
      await devirIste(ort);
      const s = await kilitTut(ort, true);
      if (!s) throw new Error("kilit_alinamadi");
      return s;
    },
  };
}

/** Gercek tarayici ortami. */
export function gercekSekmeOrtami(): SekmeOrtami {
  const locks = typeof navigator !== "undefined" ? ((navigator as unknown as { locks?: KilitYuzu }).locks ?? null) : null;
  const BC = typeof BroadcastChannel !== "undefined" ? BroadcastChannel : null;
  return {
    locks,
    kanalUret: BC ? (ad) => new BC(ad) as unknown as KanalYuzu : null,
    bekle: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
