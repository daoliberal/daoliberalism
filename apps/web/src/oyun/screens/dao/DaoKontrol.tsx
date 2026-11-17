"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
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
        <Button variant="primary" size="sm" disabled={kapali || running} onClick={() => send("step")}>
          {t("dao.bir_hafta")}
        </Button>
        <Button variant="secondary" size="sm" disabled={kapali || running} onClick={() => send("olay")}>
          {t("dao.olay_kadar")}
        </Button>
        <Button variant="secondary" size="sm" disabled={!running} onClick={() => send("pause")}>
          {t("dao.duraklat")}
        </Button>
      </div>
      {state.computing ? <p role="status" className={styles.durum}>{t("dao.hesaplaniyor")}</p> : null}
      {hata !== null ? <p role="alert" className={styles.hata}>{hata}</p> : null}
    </section>
  );
}
