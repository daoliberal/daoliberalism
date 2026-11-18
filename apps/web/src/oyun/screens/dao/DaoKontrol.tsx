"use client";
import { useEffect, useRef, useState } from "react";
import { FastForwardIcon, PauseIcon, StepIcon } from "@/components/primitives/icons";
import { IkonDugmesi } from "@/oyun/ui/IkonDugmesi";
import { t } from "@/oyun/copy/t";
import { daoKontrolHataAnahtari } from "@/oyun/sim/dao";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { RunState, Speed } from "@/oyun/sim/types";
import styles from "./DaoKontrol.module.css";

/** Sunucunun varsayılan koşu hızı (`RunState.speed` başlangıcı). */
const VARSAYILAN_HIZ: Speed = 1;

/**
 * Oyun kontrolü: 1 hafta, bir şey olana kadar, duraklat. Hesaplanırken ve bitince kapalıdır.
 * DAO ekranında hız seçici yoktur: koşu sunucunun varsayılan hızıyla (1) çalışır. Sunucu `olay` eyleminde hızı 16'ya
 * çeker ve orada bırakır; olay yüzünden durunca varsayılan hız `pause` + `speed` ile geri yüklenir.
 * Hız her zaman sunucunun söylediği değerdir ve ekranda yazılıdır.
 */
export function DaoKontrol({ runId, state }: { runId: string; state: RunState }) {
  const source = useSimSource();
  const running = state.status === "running";
  const kapali = state.computing || state.status === "ended" || state.status === "failed";
  const [hata, setHata] = useState<string | null>(null);
  /** `olay` basılınca kurulur: olayın gerçekten başlayıp başlamadığı (`running` görüldü mü); geri yükleme ancak ondan sonra. */
  const onceki = useRef<{ basladi: boolean } | null>(null);

  const gonder = (cmd: { action: "step" | "olay" | "pause"; speed?: Speed }, yanit?: (s: RunState) => void): void => {
    source.control(runId, cmd).then(
      (s) => {
        setHata(null);
        yanit?.(s);
      },
      (e: unknown) => {
        if (cmd.action === "olay") onceki.current = null;
        setHata(t(daoKontrolHataAnahtari(e)));
      },
    );
  };
  /** Varsayılan hıza dön: `pause` + `speed` (sunucu olay hızını 16'da bırakır). */
  const geriYukle = (simdiki: RunState): void => {
    if (onceki.current === null) return;
    onceki.current = null;
    if (simdiki.speed !== VARSAYILAN_HIZ && simdiki.status !== "ended") gonder({ action: "pause", speed: VARSAYILAN_HIZ });
  };
  const send = (action: "step" | "olay" | "pause"): void => {
    if (action !== "olay") return gonder({ action });
    onceki.current = state.speed === VARSAYILAN_HIZ ? { basladi: false } : null;
    // Yanıt zaten `running` değilse (ilk haftada olay çıktı) olay bitmiştir: akıştaki `running` beklenmez.
    gonder({ action }, (s) => {
      if (s.status !== "running") geriYukle(s);
    });
  };

  useEffect(() => {
    const o = onceki.current;
    if (o === null) return;
    if (state.status === "running") {
      o.basladi = true;
      return;
    }
    if (o.basladi && !state.computing) geriYukle(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.computing, state.speed]);

  return (
    <section aria-label={t("dao.kontrol")} className={styles.kontrol}>
      <p className={styles.hafta}>
        <strong>{t("dao.hafta", { n: state.week, toplam: state.durationWeeks })}</strong>
        <span className={styles.hiz} aria-live="polite">{t("dao.hiz", { n: state.speed })}</span>
      </p>
      <div className={styles.dugmeler}>
        <IkonDugmesi yukari variant="primary" etiket={t("dao.bir_hafta")} ikon={<StepIcon size="20" />} disabled={kapali || running} onClick={() => send("step")} />
        <IkonDugmesi yukari variant="secondary" etiket={t("dao.olay_kadar")} ikon={<FastForwardIcon size="20" />} disabled={kapali || running} onClick={() => send("olay")} />
        <IkonDugmesi yukari variant="secondary" etiket={t("dao.duraklat")} ikon={<PauseIcon size="20" />} disabled={!running} onClick={() => send("pause")} />
      </div>
      {state.computing ? <p role="status" className={styles.durum}>{t("dao.hesaplaniyor")}</p> : null}
      {hata !== null ? <p role="alert" className={styles.hata}>{hata}</p> : null}
    </section>
  );
}
