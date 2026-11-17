"""\"Ne olmuyor\" tanıları (S4): açık bir kuralın beklenen etkisi modelde gerçekleşmiyorsa nedenini söyler. Saf; yalnız stdlib.

Kurallar `registry/tanilar.json`'dadır: `{id, requires_cards, when, textKey, rule_ids}`.
- `requires_cards`: `{kart: değer}`; değer bir metin, metin listesi (hangisi olursa) ya da `"*"` (kart kayıtta var) olabilir.
  Kartın etkin değeri koşunun değerindeki karttır; koşuda yoksa kartın varsayılanıdır. Kural kapalıyken tanı çıkmaz.
- `when`: koşul listesi, hepsi birlikte geçerli olmalıdır; her koşul `{alan, op, hafta_sayisi}` + sağ taraf:
  `esik` (sayı), `esik_param` (etkin model parametresi) ya da `alan2` (aynı haftanın başka dünya alanı), `carpan` (varsayılan 1)
  sağ tarafla çarpılır. Koşul, `hafta_sayisi` hafta ARDI ARDINA sağlanmalıdır. Alan `null`/sayı değilse o hafta sağlanmaz (kural sessiz).
- Tanı, son haftada tüm koşullar kendi penceresiyle sağlanıyorsa çıkar. `since_week`: tüm koşulların birlikte sağlandığı ardışık dizinin
  ilk haftası. `params.hafta`: o dizinin uzunluğu.

Koşunun sürümü değişince (örn. kural açıldı/kapandı), tanıya giren kartlardan biri değiştiği hafta öncesi geçmiş sayılmaz: yeni
kuralın etkisi görülmeden uyarı çıkmaz (`evaluate_run`).

Olgu alanları (`extract.EXTRA_FIELDS`): `policy_rate` modelin haftalık politika faizi (`pol[0]`), `policy_unemployment` kuralın gördüğü işsizlik
(modelin ölçüsü; paketin `unemployment_rate`'inden farklıdır), `support_denied` istenip verilemeyen destek, `city_spend_cut` kısılan şehir harcaması.
"""
from __future__ import annotations

import functools
import json
import math
import operator
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from ..registry.loader import DEFAULT_DATA_DIR
from .extract import EXTRA_FIELDS, FIELDS, NULL_FIELDS

# C2'nin web tarafında önden eklediği anahtarlar (`tr.ts`); `wire_contract.json` `enums.diagnosticTextKeys` ile eşit (testle kilitli).
TEXT_KEYS = ("neolmuyor.basim_siniri", "neolmuyor.destek_yok", "neolmuyor.faiz_dusmuyor", "neolmuyor.kurulus_kredisi_yok")
RULES_FILE = "tanilar.json"

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    ">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le, "==": operator.eq, "!=": operator.ne,
}
_FIELDS = frozenset(n for n, _ in FIELDS) | frozenset(n for n, _ in EXTRA_FIELDS) | frozenset(NULL_FIELDS)


def check_rules(rules: Any) -> list[dict]:
    """Biçim denetimi (yükleme ve testler); hata `ValueError`."""
    if not isinstance(rules, list) or not rules:
        raise ValueError("tanilar: boş ya da liste değil")
    seen: set[str] = set()
    for r in rules:
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or r["id"] in seen:
            raise ValueError("tanilar: kimlik eksik ya da yinelenen")
        seen.add(r["id"])
        if r.get("textKey") not in TEXT_KEYS:
            raise ValueError("tanilar[%s]: bilinmeyen textKey" % r["id"])
        rc = r.get("requires_cards")
        if not isinstance(rc, dict) or any(not isinstance(k, str) or not (v == "*" or isinstance(v, str) or
                                                                           (isinstance(v, list) and v and all(isinstance(x, str) for x in v)))
                                           for k, v in rc.items()):
            raise ValueError("tanilar[%s]: requires_cards" % r["id"])
        ri = r.get("rule_ids")
        if not isinstance(ri, list) or not ri or any(not isinstance(x, str) for x in ri):
            raise ValueError("tanilar[%s]: rule_ids" % r["id"])
        when = r.get("when")
        if not isinstance(when, list) or not when:
            raise ValueError("tanilar[%s]: when" % r["id"])
        for c in when:
            if not isinstance(c, dict) or c.get("alan") not in _FIELDS or c.get("op") not in _OPS:
                raise ValueError("tanilar[%s]: koşul alanı/işlemi" % r["id"])
            n = c.get("hafta_sayisi")
            if type(n) is not int or n < 1:
                raise ValueError("tanilar[%s]: hafta_sayisi" % r["id"])
            rhs = [k for k in ("esik", "esik_param", "alan2") if k in c]
            if len(rhs) != 1:
                raise ValueError("tanilar[%s]: tek sağ taraf gerekir" % r["id"])
            if "esik" in c and not _is_num(c["esik"]):
                raise ValueError("tanilar[%s]: esik" % r["id"])
            if "alan2" in c and c["alan2"] not in _FIELDS:
                raise ValueError("tanilar[%s]: alan2" % r["id"])
            if "esik_param" in c and not isinstance(c["esik_param"], str):
                raise ValueError("tanilar[%s]: esik_param" % r["id"])
            if "carpan" in c and not _is_num(c["carpan"]):
                raise ValueError("tanilar[%s]: carpan" % r["id"])
    return rules


@functools.lru_cache(maxsize=4)
def _load(path: str) -> tuple:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return tuple(check_rules(data.get("tanilar")))


def load_rules(data_dir: Path | None = None) -> list[dict]:
    return list(_load(str((data_dir or DEFAULT_DATA_DIR) / RULES_FILE)))


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class _Ctx:
    """Bir değerlendirme için kart/parametre çözümü (kayıt + koşunun değerleri)."""

    def __init__(self, values: Mapping[str, Any], reg: Any):
        self.values, self.reg = values, reg
        self._param_card: dict[str, Any] = {}
        for s in reg.settings:
            for p in s.params:
                self._param_card.setdefault(p, s)

    def card_value(self, sid: str) -> Any:
        s = self.reg.by_id.get(sid)
        if s is None:
            raise KeyError(sid)
        return self.values[sid] if sid in self.values else self.reg.default_ui(s)

    def param(self, name: str) -> Any:
        """Etkin model parametresi: kart koşuda ayarlıysa çözülmüş değeri, değilse model varsayılanı."""
        s = self._param_card.get(name)
        if s is not None and s.id in self.values:
            v = self.reg.decode(s, self.values[s.id])
            if isinstance(v, dict):
                v = v.get(name)
            return v
        return self.reg.defaults.get(name)

    def param_card_id(self, name: str) -> str | None:
        s = self._param_card.get(name)
        return s.id if s is not None else None


def _cards_ok(rule: dict, ctx: _Ctx) -> bool:
    for sid, want in rule["requires_cards"].items():
        try:
            got = ctx.card_value(sid)
        except (KeyError, ValueError, TypeError):
            return False
        if want == "*":
            continue
        if isinstance(want, list):
            if got not in want:
                return False
        elif got != want:
            return False
    return True


def _rhs(cond: dict, w: Mapping[str, Any], ctx: _Ctx) -> Any:
    if "esik" in cond:
        base = cond["esik"]
    elif "esik_param" in cond:
        base = ctx.param(cond["esik_param"])
    else:
        base = w.get(cond["alan2"])
    if not _is_num(base):
        return None
    return base * cond.get("carpan", 1)


def _holds(cond: dict, w: Mapping[str, Any], ctx: _Ctx) -> bool:
    left = w.get(cond["alan"])
    if not _is_num(left):
        return False
    right = _rhs(cond, w, ctx)
    return right is not None and bool(_OPS[cond["op"]](left, right))


def evaluate(history: Sequence[Mapping[str, Any]], values: Mapping[str, Any], reg: Any, rules: Sequence[dict] | None = None,
             first_week: int = 1) -> list[dict]:
    """`history`: haftalık dünya alanları (eskiden yeniye, `history[0]` = `first_week`. hafta). Tanı listesi, kural dosyası sırasıyla."""
    if not history:
        return []
    ctx = _Ctx(values, reg)
    out: list[dict] = []
    n = len(history)
    for rule in (load_rules() if rules is None else rules):
        if not _cards_ok(rule, ctx):
            continue
        start = 0                                         # ortak dizinin ilk indeksi (en geç başlayan koşul belirler)
        ok = True
        for cond in rule["when"]:
            run = 0
            for i in range(n - 1, -1, -1):
                try:
                    hit = _holds(cond, history[i], ctx)
                except (KeyError, ValueError, TypeError):
                    hit = False
                if not hit:
                    break
                run += 1
            if run < cond["hafta_sayisi"]:
                ok = False
                break
            start = max(start, n - run)
        if ok:
            out.append({"id": rule["id"], "textKey": rule["textKey"], "params": {"hafta": n - start}, "rule_ids": list(rule["rule_ids"]),
                        "since_week": first_week + start})
    return out


def evaluate_run(worlds: Sequence[Mapping[str, Any]], versions: Sequence[int], version_sets: Mapping[int, Mapping[str, Any]], reg: Any,
                 rules: Sequence[dict] | None = None) -> list[dict]:
    """Koşu geçmişi için: `worlds[i]` ve `versions[i]` = (i+1). haftanın dünyası ve sürümü. Etkin değerler son sürümündür; tanıya giren
    kartların değeri farklı olan sürümlerin haftaları geçmişten atılır (sürüm değişince pencere yeniden başlar)."""
    if not worlds:
        return []
    rules = load_rules() if rules is None else list(rules)

    def vals(v: int) -> Mapping[str, Any]:
        return version_sets[max(k for k in version_sets if k <= v)]

    cur = vals(versions[-1])
    ctx = _Ctx(cur, reg)
    watched: set[str] = set()
    for r in rules:
        watched.update(r["requires_cards"])
        for c in r["when"]:
            if "esik_param" in c:
                sid = ctx.param_card_id(c["esik_param"])
                if sid:
                    watched.add(sid)
    key = tuple(sorted(watched))
    same: dict[int, bool] = {}
    start = len(worlds) - 1
    while start > 0:
        v = versions[start - 1]
        if v not in same:
            old = vals(v)
            same[v] = all(old.get(k) == cur.get(k) for k in key)
        if not same[v]:
            break
        start -= 1
    return evaluate(worlds[start:], cur, reg, rules, first_week=start + 1)
