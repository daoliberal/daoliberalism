/**
 * B9: ölçüm kancası. YALNIZ `NEXT_PUBLIC_OYUN_OLCUM=1` ile derlenen yayında etkindir (Playwright ölçüm betiği: `e2e/olcum/`); bayraksız derlemede bu modülün
 * her işlevi ilk satırda döner ve derleyici `OLCUM &&` dallarını budar (üretim davranışı ve çıktısı değişmez; `tests/oyun/tarayici/olcumKancasi.test.ts` kilitler).
 *
 * Kanca YALNIZ gözlemler: model durumunu, olay sırasını ya da zamanlamayı değiştirmez.
 *   ana iş parçacığı  `globalThis.__oyunOlcum = { tepe, kopru }`: köprünün iç tepe değerleri (yazım kuyruğu, bekçi sessizliği) ve köprü nesnesi (betik
 *                     `gonder` ile oynatma/karar/şart isteklerini kullanıcı yoluyla aynı koddan geçirir).
 *   Worker            `self.__oyunOlcum = { py, gunluk, bellek() }`: Pyodide örneği (yığın uzunluğu, yaşayan bellek), giden her yanıtın zaman/yığın kaydı.
 */
import type { IsciMesaji } from "./protokol";

/** Derleme zamanı sabiti (Next yalnız `next.config.ts` `env` ile sabitlenen değişkeni yerine koyar). */
export const OLCUM = process.env.NEXT_PUBLIC_OYUN_OLCUM === "1";

interface Kok {
  [alan: string]: unknown;
}

function kok(): Kok | null {
  if (!OLCUM) return null;
  const g = globalThis as { __oyunOlcum?: Kok };
  return (g.__oyunOlcum ??= {});
}

// ---- ana iş parçacığı -----------------------------------------------------------------------------------------

/** Ada göre en büyük değeri tutar (örn. `yazimKuyrugu`). */
export function olcumTepe(ad: string, deger: number): void {
  const k = kok();
  if (k === null) return;
  const tepe = (k.tepe ??= {}) as Record<string, number>;
  if (!(deger <= (tepe[ad] ?? -Infinity))) tepe[ad] = deger;
}

/** Köprü nesnesini betiğe verir. */
export function olcumKopru(kopru: unknown): void {
  const k = kok();
  if (k !== null) k.kopru = kopru;
}

// ---- Worker ---------------------------------------------------------------------------------------------------

/** Worker'dan giden bir yanıtın kaydı (`self.__oyunOlcum.gunluk`). */
export interface GidenKayit {
  /** Giderken `performance.timeOrigin + performance.now()` (ms; ana iş parçacığının aynı ifadesiyle karşılaştırılır). */
  t: number;
  id: number | null;
  tur: IsciMesaji["t"];
  /** `postMessage` çağrısının süresi (ms): yapılandırılmış kopya (serileştirme) Worker tarafında. */
  postMs: number;
  /** wasm yığınının o andaki boyutu (bayt; yalnız büyür). */
  yigin: number;
  /** Tick yanıtı: Python `tick()` süresi (ms). */
  tickMs?: number;
  /** Tick yanıtında hafta olayları: hafta numarası ve JSON bayt boyutu (K10: Worker -> ana taşıma maliyeti). */
  haftalar?: { hafta: number; bayt: number }[];
}

interface PyYuzu {
  _module?: { HEAP8?: { length: number } };
  runPython(kod: string): unknown;
}

const BELLEK_PY = `
import gc, ctypes, time, json
_t0 = time.perf_counter()
gc.collect()
_gc_ms = (time.perf_counter() - _t0) * 1000
class _MI(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint) for n in ("arena","ordblks","smblks","hblks","hblkhd","usmblks","fsmblks","uordblks","fordblks","keepcost")]
_libc = ctypes.CDLL(None)
_libc.mallinfo.restype = _MI
_m = _libc.mallinfo()
json.dumps({"yasayan": _m.uordblks, "arena": _m.arena, "bos": _m.fordblks, "gc_ms": _gc_ms})
`;

function pyYuzu(): PyYuzu | null {
  const k = (globalThis as { __oyunOlcum?: Kok }).__oyunOlcum;
  return (k?.py as PyYuzu | undefined) ?? null;
}

/**
 * Worker: `loadPyodide` sonucunu ölçüm köküne bağlar. Bayraksızsa verilen modülü AYNEN döner.
 * `bellek()`: `gc.collect()` + dlmalloc `mallinfo` (B1/B3 yöntemi; `sys.getallocatedblocks` Pyodide'de hep 0) + `HEAP8.length`; Worker iş parçacığında SENKRON koşar.
 */
export function olcumPyodideSar<M extends { loadPyodide(...a: never[]): Promise<unknown> }>(modul: M): M {
  if (!OLCUM) return modul;
  const kok = ((globalThis as { __oyunOlcum?: Kok }).__oyunOlcum ??= {});
  kok.gunluk = [] as GidenKayit[];
  kok.bellek = (): Record<string, number> => {
    const py = pyYuzu();
    if (py === null) throw new Error("pyodide_yok");
    const o = JSON.parse(String(py.runPython(BELLEK_PY))) as Record<string, number>;
    return { ...o, yigin: py._module?.HEAP8?.length ?? 0 };
  };
  const asil = modul.loadPyodide.bind(modul) as (...a: never[]) => Promise<unknown>;
  return {
    ...modul,
    loadPyodide: async (...a: never[]) => {
      const py = await asil(...a);
      kok.py = py;
      return py;
    },
  } as M;
}

/** Worker: `bildir` (postMessage) sarmalayıcısı; bayraksızsa verileni AYNEN döner. */
export function olcumBildirSar<B extends (m: IsciMesaji, aktar?: Transferable[]) => void>(bildir: B): B {
  if (!OLCUM) return bildir;
  const sar = (m: IsciMesaji, aktar?: Transferable[]): void => {
    const t0 = performance.now();
    bildir(m, aktar);
    const postMs = performance.now() - t0;
    const k = (globalThis as { __oyunOlcum?: Kok }).__oyunOlcum;
    const gunluk = k?.gunluk as GidenKayit[] | undefined;
    if (gunluk === undefined) return;
    const yigin = pyYuzu()?._module?.HEAP8?.length ?? 0;
    const kayit: GidenKayit = { t: performance.timeOrigin + t0, id: m.t === "yanit" ? m.id : null, tur: m.t, postMs, yigin };
    if (m.t === "yanit" && m.ok) {
      const s = m.s as { ms?: unknown; olaylar?: { olaylar?: { event?: string; data?: unknown }[] }[] } | null;
      if (s !== null && typeof s === "object" && typeof s.ms === "number" && Array.isArray(s.olaylar)) {
        kayit.tickMs = s.ms;
        const haftalar: { hafta: number; bayt: number }[] = [];
        for (const a of s.olaylar) {
          for (const o of a.olaylar ?? []) {
            if (o.event === "week") haftalar.push({ hafta: (o.data as { week?: number } | null)?.week ?? -1, bayt: JSON.stringify(o.data).length });
          }
        }
        if (haftalar.length > 0) kayit.haftalar = haftalar;
      }
    }
    gunluk.push(kayit);
  };
  return sar as B;
}
