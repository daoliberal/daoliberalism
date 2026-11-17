"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Canlı Dünya alt görünümü: dünya, beş şehirden biri, zincir ya da harita. */
export type CanliGorunum = "dunya" | "zincir" | "harita" | `sehir-${0 | 1 | 2 | 3 | 4}`;

export type OyunRoute =
  | { name: "baslangic" }
  | { name: "kurucu"; rehberli?: true; adim?: string; uzman?: true }
  | { name: "canli"; runId: string; view?: CanliGorunum }
  | { name: "sonuc"; runId: string }
  | { name: "kosular" }
  | { name: "dao"; runId?: string; dunya?: string; sehir?: SehirNo }
  | { name: "stil" };

export type SehirNo = 0 | 1 | 2 | 3 | 4;

const CANLI = "#/canli/";
const SONUC = "#/sonuc/";
const KURUCU = "#/kurucu";
const DAO = "#/dao";
const DAO_DUNYA = "#/dao/d/";
const VIEW = /^(?:dunya|zincir|harita|sehir-[0-4])$/;
/** Yeni biçimde şehir numarası: `#/canli/<id>/<0-4>`, `#/dao/<id>/<0-4>`. */
const SEHIR_NO = /^[0-4]$/;

/**
 * DK-14: `#/` Başlangıç, `#/kurucu[/<adım>[/uzman]]`, `#/kurucu/rehberli[/<adım>]`, `#/canli/<runId>[/<görünüm>]`, `#/sonuc/<runId>`, `#/kosular`, `#/dao[/<runId>]`, `#/dao/d/<kod>` (paylaşılan dünya).
 * Eski `#/canli/<runId>` bağlantıları aynen çalışır; sondaki parça yalnız geçerli bir görünüm adıysa görünümdür.
 */
export function parseHash(hash: string): OyunRoute {
  if (hash === KURUCU || hash.startsWith(`${KURUCU}/`)) {
    const parts = hash.slice(KURUCU.length).split("/").filter((x) => x !== "");
    const rehberli = parts[0] === "rehberli";
    const adim = (rehberli ? parts[1] : parts[0]) ?? undefined;
    // `uzman`: yalnız tam Kurucu'da ve bir adımın ardından ("Uzman ayarlarını aç": uzman kartlar açık başlar).
    const uzman = !rehberli && adim !== undefined && parts[1] === "uzman";
    return { name: "kurucu", ...(rehberli ? { rehberli: true as const } : {}), ...(adim !== undefined ? { adim } : {}), ...(uzman ? { uzman: true as const } : {}) };
  }
  if (hash.startsWith(CANLI) && hash.length > CANLI.length) {
    const rest = hash.slice(CANLI.length);
    const cut = rest.lastIndexOf("/");
    const tail = cut > 0 ? rest.slice(cut + 1) : "";
    if (VIEW.test(tail)) return { name: "canli", runId: rest.slice(0, cut), view: tail as CanliGorunum };
    if (SEHIR_NO.test(tail)) return { name: "canli", runId: rest.slice(0, cut), view: `sehir-${tail}` as CanliGorunum };
    return { name: "canli", runId: rest };
  }
  if (hash.startsWith(SONUC) && hash.length > SONUC.length) return { name: "sonuc", runId: hash.slice(SONUC.length) };
  if (hash === "#/kosular") return { name: "kosular" };
  if (hash === "#/stil" || hash.startsWith("#/stil?")) return { name: "stil" };
  // Boş kod (`#/dao/d`, `#/dao/d/`) ve sondaki eğik çizgi (`#/dao/`) giriş ekranıdır; "d" bir koşu kimliği sayılmaz.
  if (hash === DAO || hash === `${DAO}/` || hash === DAO_DUNYA || hash === DAO_DUNYA.slice(0, -1)) return { name: "dao" };
  if (hash.startsWith(DAO_DUNYA) && hash.length > DAO_DUNYA.length) return { name: "dao", dunya: hash.slice(DAO_DUNYA.length) };
  if (hash.startsWith(`${DAO}/`) && hash.length > DAO.length + 1) {
    const rest = hash.slice(DAO.length + 1);
    const cut = rest.lastIndexOf("/");
    if (cut > 0 && SEHIR_NO.test(rest.slice(cut + 1))) return { name: "dao", runId: rest.slice(0, cut), sehir: Number(rest.slice(cut + 1)) as SehirNo };
    return { name: "dao", runId: rest };
  }
  return { name: "baslangic" };
}

export function toHash(r: OyunRoute): string {
  switch (r.name) {
    case "baslangic": return "#/";
    case "kurucu": return `${KURUCU}${r.rehberli ? "/rehberli" : ""}${r.adim !== undefined ? `/${r.adim}${r.uzman && !r.rehberli ? "/uzman" : ""}` : ""}`;
    case "canli": return `${CANLI}${r.runId}${r.view !== undefined ? `/${r.view.startsWith("sehir-") ? r.view.slice(6) : r.view}` : ""}`;
    case "sonuc": return `${SONUC}${r.runId}`;
    case "kosular": return "#/kosular";
    case "stil": return "#/stil";
    case "dao": return r.dunya !== undefined ? `${DAO_DUNYA}${r.dunya}` : r.runId !== undefined ? `${DAO}/${r.runId}${r.sehir !== undefined ? `/${r.sehir}` : ""}` : DAO;
  }
}

/**
 * Eski Kurucu görünüm rotalarının yeni karşılığı; yönlendirme gerekmiyorsa `null`.
 * `#/canli/<id>/sehir-<n>` -> `#/canli/<id>/<n>`; `/dunya` ve `/harita` (eski sayfa görünümleri artık şehir ekranının kendisi) -> `#/canli/<id>`.
 * `/zincir` yerinde kalır: şehir ekranı Ayrıntılar penceresini Zincir sekmesinde açar.
 */
export function kanonikHash(hash: string): string | null {
  const r = parseHash(hash);
  if (r.name !== "canli" || r.view === undefined) return null;
  if (r.view === "dunya" || r.view === "harita") return toHash({ name: "canli", runId: r.runId });
  if (!r.view.startsWith("sehir-")) return null;
  const yeni = toHash(r);
  return yeni === hash ? null : yeni;
}

/** `replace` bildirimsizdir (hashchange yok); aynı sayfadaki kanca örneklerini bu dinleyiciler günceller. */
const local = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  local.add(onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    local.delete(onChange);
  };
}
const getSnapshot = (): string => window.location.hash;
const getServerSnapshot = (): string => "";

/** Şehir ekranı (tam ekran çerçeve): her Kurucu koşu rotası (şehir verilmezse ilk şehir) ve her DAO koşu rotası (şehir verilmezse oyuncunun şehri). */
export function sehirRotasi(r: OyunRoute): boolean {
  return r.name === "canli" || (r.name === "dao" && r.runId !== undefined);
}

/** Giriş ekranı (tam ekran giriş kabuğu): Başlangıç, Kurucu kurulumu ve DAO girişi (koşu ya da paylaşılan dünya olmadan). */
export function girisRotasi(r: OyunRoute): boolean {
  return r.name === "baslangic" || r.name === "kurucu" || (r.name === "dao" && r.runId === undefined && r.dunya === undefined);
}

export function useHashRoute(): { route: OyunRoute; go(r: OyunRoute): void; replace(r: OyunRoute): void } {
  const hash = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const route = useMemo(() => parseHash(hash), [hash]);
  const go = useCallback((r: OyunRoute) => {
    window.location.hash = toHash(r);
  }, []);
  const replace = useCallback((r: OyunRoute) => {
    window.history.replaceState(window.history.state, "", toHash(r));
    for (const l of [...local]) l();
  }, []);
  return { route, go, replace };
}
