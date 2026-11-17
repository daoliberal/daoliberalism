import { ipucuMetni } from "./izoIpucuYer";
import type { GorselDurum } from "./izoDurum";
import styles from "./IzoIpucu.module.css";

/** Bina ipucusu verisi: `calisan` yalnız işletmede (null = durum ve çalışan satırı yok); `x, y` tuval kutusuna göre piksel konumudur. */
export type IpucuVerisi = { ad: string; durum: GorselDurum; calisan: number | null; sahip: "npc" | "oyuncu" | "dao" | null; x: number; y: number };

/**
 * Bina ipucusunun erişilebilir kopyası (`role="tooltip"`, yalnız ekran okuyucuya görünür). Görünen kutu izometrik Pixi sahnesinde çizilir ve imleci izler
 * (`style` ve `setProperty` tasarım kuralıyla yasak, DOM kutusunu imlece bağlamak mümkün değil). Tuval kapsayıcısı `aria-describedby={id}` ile bağlanır;
 * aynı bilgi erişilebilir tabloda da vardır (klavye ve ekran okuyucu yedeği).
 */
export function IzoIpucu({ id, veri }: { id: string; veri: IpucuVerisi | null }) {
  if (veri === null) return null;
  const m = ipucuMetni(veri);
  return (
    <div id={id} role="tooltip" className={styles.ipucu}>
      <strong>{m.baslik}</strong>
      {m.detay.map((d) => <span key={d}>{d}</span>)}
    </div>
  );
}
