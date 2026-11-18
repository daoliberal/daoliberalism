"use client";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/primitives/Button";
import { FastForwardIcon, PauseIcon, PlayIcon, StepIcon } from "@/components/primitives/icons";
import { IkonDugmesi } from "@/oyun/ui/IkonDugmesi";
import { t } from "@/oyun/copy/t";
import { useSimSource } from "@/oyun/sim/SimSourceContext";
import type { RunState, SimSource, Speed } from "@/oyun/sim/types";
import stil from "./SaatCubugu.module.css";
import { kisayolHedefiUygun } from "./kisayolKapsami";

const SPEEDS: readonly Speed[] = [1, 4, 16];
const KEY_SPEED: Record<string, Speed> = { "1": 1, "2": 4, "3": 16 };

/** "Şartı değiştir" düğmesi: panel kapanınca odak ona döner. */
/** Üst çubuktaki "Şartı değiştir" düğmesinin kimliği (diyalog kapanınca odak ona döner). */
export const DEGISTIR_ID = "oyun-sarti-degistir";

type Cmd = Parameters<SimSource["control"]>[1];

/** Zaman kontrolleri (üst orta yuva): hafta, oynat/duraklat, tek hafta, hız {1,4,16}, sonraki kritik olaya atla, Şartı değiştir. `computing` iken hepsi kapalıdır; koşu bitince "Şartı değiştir" yoktur. */
export function SaatCubugu({ runId, state, onDegistir, panelAcik }: { runId: string; state: RunState; onDegistir(): void; panelAcik: boolean }) {
  const source = useSimSource();
  const running = state.status === "running";
  const off = state.computing || state.status === "ended" || state.status === "failed";
  /** Şart paneli açıkken koşu duraklatılmış kalır: oynatma komutları kapalıdır. */
  const kilit = off || panelAcik;
  /** Atlama sürerken: kaynak aboneliğini kapatan işlev (kritik olayda senkron durdurmak için React'ten bağımsız abonelik). */
  const jump = useRef<(() => void) | null>(null);
  const endJump = useCallback(() => {
    const off = jump.current;
    jump.current = null;
    off?.();
  }, []);

  const send = useCallback(
    (cmd: Cmd) => {
      source.control(runId, cmd).catch(() => {});
    },
    [source, runId],
  );

  const toggle = useCallback(() => {
    endJump();
    send(running ? { action: "pause" } : { action: "play", speed: state.speed });
  }, [send, endJump, running, state.speed]);
  const step = useCallback(() => {
    endJump();
    send({ action: "step" });
  }, [send, endJump]);
  /** Hız yalnız hızı ayarlar (prototip): çalışıyorsa oynatma sürer, duraklatıksa duraklatık kalır. */
  const play = useCallback(
    (speed: Speed) => {
      endJump();
      send({ action: running ? "play" : "pause", speed });
    },
    [send, endJump, running],
  );
  const skip = useCallback(() => {
    endJump();
    const back = state.speed;
    let armed = false;
    const off = source.subscribe(runId, (e) => {
      // Abonelik anında yeniden oynatılan geçmiş olaylar sayılmaz; yalnız bundan sonra gelen kritik olay durdurur.
      if (!armed) return;
      if (e.type === "world_event" && e.event.critical) {
        endJump();
        send({ action: "pause", speed: back });
      } else if (e.type === "ended" || (e.type === "state" && e.state.status !== "running")) {
        endJump();
      }
    });
    armed = true;
    jump.current = off;
    send({ action: "play", speed: 16 });
  }, [source, runId, send, endJump, state.speed]);

  // Koşu kimliği değişince (şart değişikliği) ya da bileşen kalkınca atlama aboneliği eski koşuda kalmaz.
  useEffect(() => endJump, [endJump, runId]);

  const degistir = useCallback(() => {
    endJump();
    if (running) send({ action: "pause" });
    onDegistir();
  }, [endJump, running, send, onDegistir]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || kilit || !kisayolHedefiUygun(e.target)) return;
      const onButton = e.target instanceof HTMLElement && ["BUTTON", "A"].includes(e.target.tagName);
      if (e.key === " " && !onButton) {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") {
        step();
      } else if ((e.key === "r" || e.key === "R") && !onButton) {
        degistir();
      } else if (e.key in KEY_SPEED) {
        play(KEY_SPEED[e.key]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kilit, toggle, step, play, degistir]);

  return (
    <section aria-label={t("canli.saat")} className={stil.zaman} title={t("canli.klavye")}>
      <p className={stil.hafta}>
        <strong>{t("canli.hafta", { n: state.week, toplam: state.durationWeeks })}</strong>
        <span className={stil.bilgi}>{t("canli.baslik", { ad: state.name })}</span>
        <span className={stil.bilgi}>{t("canli.surum", { n: state.version })}</span>
        <span className={stil.bilgi}>{t(source.kind === "live" ? "canli.kaynak.live" : "canli.kaynak.replay")}</span>
      </p>
      <div className={stil.satir}>
        <div className={stil.dugmeler}>
          <div className={stil.grup}>
            <IkonDugmesi
              variant="toggle"
              etiket={running ? t("canli.duraklat") : t("canli.oynat")}
              ikon={running ? <PauseIcon size="20" /> : <PlayIcon size="20" />}
              pressed={running}
              disabled={kilit}
              onClick={toggle}
            />
            <div role="group" aria-label={t("canli.hiz_grup")} className={stil.hizlar}>
              {SPEEDS.map((s) => (
                <Button key={s} variant="toggle" size="sm" pressed={state.speed === s} disabled={kilit} onClick={() => play(s)}>
                  {t("canli.hiz", { n: s })}
                </Button>
              ))}
            </div>
          </div>
          <div className={`${stil.grup} ${stil.grupAdim}`}>
            <IkonDugmesi variant="secondary" etiket={t("canli.tek_hafta")} ikon={<StepIcon size="20" />} disabled={kilit || running} onClick={step} />
            <IkonDugmesi variant="secondary" etiket={t("canli.atla")} ikon={<FastForwardIcon size="20" />} disabled={kilit || running} onClick={skip} />
          </div>
        </div>
      </div>
      {source.kind === "live" && state.buffering === true ? (
        <div role="status" className={stil.durum}>
          {/* İlk hafta gelmeden (model kuruluyor) "model hızı sınırı" demek yanlış olur: ayrı, dürüst metin. */}
          <p>{t(state.week === 0 ? "canli.model_hazirlaniyor" : "canli.hiz_siniri")}</p>
          {state.week > 0 && state.modelWeeksPerSec !== undefined ? <p>{t("canli.hiz_olcu", { n: state.modelWeeksPerSec.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) })}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
