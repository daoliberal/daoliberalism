"""B5: Web Worker (JS) <-> `TarayiciCekirdegi` sinir katmani. YALNIZ tarayici yolu; model ve sunucu kipi degismez.

Worker her cagriyi `IsciKopru` uzerinden yapar. Her yontem BIR JSON DIZGESI doner (Python istisnasi JS'e sizmaz):
  - basari: `{"ok":true,"s":<sonuc>}`
  - hata:   `{"ok":false,"hata":{"tur":<Python sinif adi>,"mesaj":<ileti>,"fark":<UyumsuzGoruntu.fark ya da null>}}`
Boylece B4b `CekirdekHatasi{tur, mesaj, fark}` sozlesmesi (UyumsuzGoruntu/GuvensizGoruntu/GoruntuHazirDegil/ValueError/TooManyRuns) bayt kaybetmeden tasinir
(pyodide `PythonError` yalniz sinif adini ve izleme metnini verir; `fark` oraya cikmaz).

JS tarafindan verilen geri cagrilar (`sink`, `ilerleme`) JS fonksiyonudur. `sink`e verilen parcalar JS `Uint8Array` KOPYASIdir (`to_js`):
transfer listesiyle ana is parcacigina tasinabilir (wasm yigini degil). `goruntu_al` tick'ler arasinda cagrilmalidir.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from .cekirdek import TarayiciCekirdegi


def _dizge(o: Any) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"), default=str)


def _fark(e: BaseException) -> Any:
    f = getattr(e, "fark", None)
    if not isinstance(f, dict):
        return None
    return json.loads(_dizge(f))                                 # tuple -> liste; JSON'a dokunmayan degerler `str`


class IsciKopru:
    def __init__(self, core: TarayiciCekirdegi, to_js: Callable[[Any], Any] | None = None):
        """`to_js`: Pyodide'de `pyodide.ffi.to_js`; testlerde (CPython) verilmezse `bytes` aynen gecer."""
        self.core = core
        self._to_js = to_js

    # ---- ortak -------------------------------------------------------------------------------------------------
    def _sar(self, f: Callable[[], str]) -> str:
        try:
            return '{"ok":true,"s":' + f() + "}"
        except Exception as e:                                   # noqa: BLE001 - sinir: her istisna yapili hataya cevrilir
            return '{"ok":false,"hata":' + _dizge({"tur": type(e).__name__, "mesaj": str(e), "fark": _fark(e)}) + "}"

    # ---- HTTP + olaylar ----------------------------------------------------------------------------------------
    def istek(self, yontem: str, yol: str, govde_json: str | None = None, arsiv_json: str | None = None) -> str:
        return self._sar(lambda: self.core.istek_json(yontem, yol, govde_json, arsiv_json))

    def tick(self, aboneler: list) -> str:
        """Bir hafta adimi (`tick`) + verilen abonelerin olaylari. `{"olaylar":[{abone, olaylar, kapandi}]}` biciminde `s` = `[...]`."""
        def is_() -> str:
            self.core.tick()
            return self._olaylar_dizgesi(aboneler)
        return self._sar(is_)

    def olaylar(self, aboneler: list) -> str:
        return self._sar(lambda: self._olaylar_dizgesi(aboneler))

    def _olaylar_dizgesi(self, aboneler: list) -> str:
        out = []
        for a in aboneler:
            r = self.core.olaylar(int(a))
            out.append({"abone": int(a), "olaylar": r["olaylar"], "kapandi": r["kapandi"]})
        return _dizge(out)

    def olay_kapat(self, abone: int) -> str:
        def is_() -> str:
            self.core.olay_kapat(int(abone))
            return "null"
        return self._sar(is_)

    def p50(self, sn: float | None) -> str:
        def is_() -> str:
            self.core.p50_ayarla(None if sn is None else float(sn))
            return "null"
        return self._sar(is_)

    # ---- kayit / devam -----------------------------------------------------------------------------------------
    def uyumluluk_anahtari(self) -> str:
        return self._sar(lambda: _dizge(self.core.uyumluluk_anahtari()))

    def goruntu_gerekli(self, kosu_id: str) -> str:
        return self._sar(lambda: _dizge(bool(self.core.goruntu_gerekli(kosu_id))))

    def goruntu_al(self, kosu_id: str, sink: Callable[[Any], Any]) -> str:
        """`sink` JS fonksiyonu: her sikisik parca icin `Uint8Array` kopyasiyla cagrilir. Hata olursa parcalarin atilmasi cagiranindir."""
        donustur = self._to_js
        return self._sar(lambda: self.core.goruntu_al_json(kosu_id, (lambda b: sink(donustur(b))) if donustur else sink))

    def gunluk_al(self, kosu_id: str, sonra: int = 0) -> str:
        return self._sar(lambda: self.core.gunluk_al_json(kosu_id, int(sonra)))

    def tarif_al(self, kosu_id: str) -> str:
        return self._sar(lambda: _dizge(self.core.tarif_al(kosu_id)))

    def devam(self, parcalar: Any, yonetici_json: str, gunluk_json: str, hedef_hafta: int, paketler_json: str | None = None,
              kosu_id: str | None = None, ebeveyn_json: str | None = None, azami_hafta: int | None = 12, ilerleme: Callable[[int], Any] | None = None) -> str:
        """`parcalar`: JS `Uint8Array` dizisi (ya da bytes listesi); `bytes`a cevrilir."""
        def bayt(p: Any) -> bytes:
            return p.to_bytes() if hasattr(p, "to_bytes") else bytes(p)
        return self._sar(lambda: self.core.devam_json([bayt(p) for p in parcalar], yonetici_json, gunluk_json, int(hedef_hafta), paketler_json,
                                                      kosu_id, ebeveyn_json, None if azami_hafta is None else int(azami_hafta), ilerleme))

    def tariften_oynat(self, tarif_json: str, gunluk_json: str, hedef_hafta: int, kosu_id: str | None = None, azami_hafta: int | None = None,
                       ilerleme: Callable[[int], Any] | None = None) -> str:
        return self._sar(lambda: self.core.tariften_oynat_json(tarif_json, gunluk_json, int(hedef_hafta), kosu_id,
                                                                None if azami_hafta is None else int(azami_hafta), ilerleme))

    def kapat(self) -> str:
        def is_() -> str:
            self.core.kapat()
            return "null"
        return self._sar(is_)


def kur(to_js: Callable[[Any], Any] | None = None, **kw: Any) -> IsciKopru:
    """Worker girisi: `oyun_server.tarayici.isci_kopru.kur(to_js)`; cekirdegi kurar (`kw` -> `TarayiciCekirdegi`)."""
    return IsciKopru(TarayiciCekirdegi(**kw), to_js)
