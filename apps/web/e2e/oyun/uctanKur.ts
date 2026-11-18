/**
 * B10 globalSetup: iki derleme (B7 duzeni) BIR KEZ kurulur, tum motorlar ve senaryolar bunlari kullanir.
 *   s1 = bayrakli (tarayici) derleme, s2 = s1 + YENI model paketi (model agacinin gecici KOPYASINDA zararsiz yorum; depodaki dosyaya dokunulmaz).
 * `apps/web/out` yedeklenir ve teardown'da geri konur. `E2E_UCTAN_DIZIN` verilir ve s1/s2 varsa derleme atlanir (gelistirme; teardown silmez/yazmaz).
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { derle, gecici, outGeriYukle, outYedekle, yeniModelSurumu } from "./swSunucu";

export default async function kur(): Promise<(() => Promise<void>) | undefined> {
  const sabit = process.env.E2E_UCTAN_DIZIN;
  if (sabit && existsSync(path.join(sabit, "s1")) && existsSync(path.join(sabit, "s2"))) return undefined;
  const tmp = sabit ?? gecici();
  mkdirSync(tmp, { recursive: true });
  const yedekVar = outYedekle(tmp);
  try {
    const s1 = path.join(tmp, "s1");
    derle(true, s1);
    yeniModelSurumu(s1, path.join(tmp, "s2"), tmp);
  } catch (e) {
    outGeriYukle(tmp, yedekVar);
    if (!sabit) rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  process.env.E2E_UCTAN_DIZIN = tmp;
  return async () => {
    outGeriYukle(tmp, yedekVar);
    if (!sabit) rmSync(tmp, { recursive: true, force: true });
  };
}
