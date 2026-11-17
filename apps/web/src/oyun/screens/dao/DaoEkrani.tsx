"use client";
import type { OyunRoute } from "@/oyun/hooks/useHashRoute";
import type { Tercih } from "@/oyun/screens/ortak/UstCubuk";
import { DaoDunya } from "./DaoDunya";
import { DaoGiris } from "./DaoGiris";
import { DaoOyun } from "./DaoOyun";

/** DAO oyunu: `#/dao` giriş, `#/dao/<runId>` oyun; `#/dao/d/<kod>` paylaşılan dünya. */
export function DaoEkrani({ route, tercih }: { route: Extract<OyunRoute, { name: "dao" }>; tercih?: Tercih }) {
  if (route.runId !== undefined) return <DaoOyun key={route.runId} runId={route.runId} {...(tercih ? { tercih } : {})} />;
  if (route.dunya !== undefined) return <DaoDunya key={route.dunya} kod={route.dunya} />;
  return <DaoGiris />;
}
