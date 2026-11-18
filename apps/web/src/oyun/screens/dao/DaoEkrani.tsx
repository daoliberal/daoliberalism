"use client";
import { useHashRoute, type OyunRoute } from "@/oyun/hooks/useHashRoute";
import type { Tercih } from "@/oyun/screens/ortak/UstCubuk";
import { AcilamazBilgisi } from "@/oyun/ui/AcilamazBilgisi";
import { YETENEKLER } from "@/oyun/yetenekler";
import { DaoDunya } from "./DaoDunya";
import { DaoGiris } from "./DaoGiris";
import { DaoOyun } from "./DaoOyun";

/** DAO oyunu: `#/dao` giriş, `#/dao/<runId>` oyun; `#/dao/d/<kod>` paylaşılan dünya. */
export function DaoEkrani({ route, tercih }: { route: Extract<OyunRoute, { name: "dao" }>; tercih?: Tercih }) {
  const { go } = useHashRoute();
  if (route.runId !== undefined) return <DaoOyun key={route.runId} runId={route.runId} {...(tercih ? { tercih } : {})} />;
  // Paylasilan dunyalar sunucu ister: tarayici kipinde anlasilir bilgi ve Baslangic'a donus.
  if (route.dunya !== undefined) return YETENEKLER.paylasilanDunyalar ? <DaoDunya key={route.dunya} kod={route.dunya} /> : <AcilamazBilgisi metin="tarayici.acilamaz.dunya" eylem="tarayici.acilamaz.baslangic" onEylem={() => go({ name: "baslangic" })} />;
  return <DaoGiris />;
}
