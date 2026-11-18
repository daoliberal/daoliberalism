import { CloseIcon } from "@/components/primitives/icons";
import { t } from "@/oyun/copy/t";
import { IkonDugmesi } from "@/oyun/ui/IkonDugmesi";
import { ipucuMetni } from "./izoIpucuYer";
import type { GorselDurum } from "./izoDurum";
import styles from "./IzoIpucu.module.css";

/** Bina ipucusu verisi: `calisan` yalnız işletmede (null = durum ve çalışan satırı yok); `x, y` tuval kutusuna göre piksel konumudur. */
export type IpucuVerisi = { ad: string; durum: GorselDurum; calisan: number | null; sahip: "npc" | "oyuncu" | "dao" | null; x: number; y: number };

/**
 * Bina ipucusunun DOM kopyası (`role="tooltip"`). Fareyle gelince görünen kutu izometrik Pixi sahnesinde imleci izler (`style` ve `setProperty` tasarım kuralıyla yasak),
 * bu kopya yalnız ekran okuyucuya görünür. `kapat` verilirse (dokunmatik: ipucu seçimle birlikte kalıcıdır) kopya GÖRÜNÜR bir bilgi kartı olur ve ✕ ile kapanır.
 * Tuval kapsayıcısı `aria-describedby={id}` ile bağlanır; aynı bilgi erişilebilir tabloda da vardır (klavye ve ekran okuyucu yedeği).
 */
export function IzoIpucu({ id, veri, kapat }: { id: string; veri: IpucuVerisi | null; kapat?: () => void }) {
  if (veri === null) return null;
  const m = ipucuMetni(veri);
  return (
    <div id={id} role="tooltip" className={kapat ? styles.kart : styles.ipucu}>
      <div className={styles.metin}>
        <strong>{m.baslik}</strong>
        {m.detay.map((d) => <span key={d}>{d}</span>)}
      </div>
      {kapat ? <IkonDugmesi variant="secondary" hiza="son" etiket={t("harita.ipucu_kapat")} ikon={<CloseIcon size="18" />} onClick={kapat} /> : null}
    </div>
  );
}
