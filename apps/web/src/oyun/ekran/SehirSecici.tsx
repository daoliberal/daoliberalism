import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CityIcon } from "@/components/primitives/icons";
import { t } from "../copy/t";
import ikonStil from "../ui/IkonDugmesi.module.css";
import type { SehirOzeti } from "./OyunEkrani";
import stil from "./SehirSecici.module.css";

/** Sağ üst köşedeki şehir seçici: düğme + liste kutusu. Ok tuşları, Home/End, Enter, Escape. */
export function SehirSecici({ sehirler, sehir, onSehir }: { sehirler: SehirOzeti[]; sehir: number; onSehir: (id: number) => void }) {
  const [acik, setAcik] = useState(false);
  const [aktif, setAktif] = useState(0);
  const kok = useRef<HTMLDivElement>(null);
  const dugme = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLUListElement>(null);
  const id = useId();
  const seciliSira = sehirler.findIndex((s) => s.id === sehir);
  // Liste küçülürse aktif sıra sınırlanır (boş listede -1).
  const aktifSira = Math.min(aktif, sehirler.length - 1);

  function ac(): void {
    setAktif(Math.max(0, seciliSira));
    setAcik(true);
  }
  function kapat(odak: boolean): void {
    setAcik(false);
    if (odak) dugme.current?.focus();
  }
  function sec(sira: number): void {
    const s = sehirler[sira];
    if (s) onSehir(s.id);
    kapat(true);
  }

  useEffect(() => {
    if (acik) liste.current?.focus();
  }, [acik]);

  useEffect(() => {
    if (!acik) return;
    const disarida = (e: PointerEvent): void => {
      if (e.target instanceof Node && !kok.current?.contains(e.target)) setAcik(false);
    };
    document.addEventListener("pointerdown", disarida);
    return () => document.removeEventListener("pointerdown", disarida);
  }, [acik]);

  function dugmeTus(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      ac();
    }
  }

  function listeTus(e: KeyboardEvent<HTMLUListElement>): void {
    const son = sehirler.length - 1;
    switch (e.key) {
      case "ArrowDown":
        setAktif((a) => Math.min(son, a + 1));
        break;
      case "ArrowUp":
        setAktif((a) => Math.max(0, a - 1));
        break;
      case "Home":
        setAktif(0);
        break;
      case "End":
        setAktif(son);
        break;
      case "Enter":
      case " ":
        sec(aktifSira);
        break;
      case "Escape":
        e.stopPropagation();
        kapat(true);
        break;
      case "Tab":
        kapat(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  }

  return (
    <div ref={kok} className={stil.kok}>
      <span className={`${ikonStil.ikonKap} ${ikonStil.ikonSonda}`}>
        <button
          ref={dugme}
          type="button"
          className={stil.dugme}
          aria-label={t("ekran.sehir_secici")}
          aria-haspopup="listbox"
          aria-expanded={acik}
          aria-controls={acik ? `${id}-liste` : undefined}
          onClick={() => (acik ? kapat(false) : ac())}
          onKeyDown={dugmeTus}
        >
          <CityIcon size="20" />
        </button>
        <span aria-hidden="true" className={ikonStil.ikonIpucu}>{t("ekran.sehir_secici")}</span>
      </span>
      {acik ? (
        <ul
          ref={liste}
          id={`${id}-liste`}
          role="listbox"
          tabIndex={-1}
          aria-label={t("ekran.sehir_liste")}
          aria-activedescendant={aktifSira >= 0 ? `${id}-${aktifSira}` : undefined}
          className={stil.liste}
          onKeyDown={listeTus}
        >
          {sehirler.map((s, i) => (
            <li
              key={s.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={s.id === sehir}
              className={`${stil.oge} ${i === aktifSira ? stil.aktif : ""}`}
              onMouseEnter={() => setAktif(i)}
              onClick={() => sec(i)}
            >
              <span className={stil.ad}>{s.ad}</span>
              {s.ozet ? <span className={stil.ozet}>{s.ozet}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
