"""Kayıt şeması: kart tanımı, hata türleri ve yapı doğrulaması."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any

LAYERS = ("P", "V", "S", "Y")
STATUSES = ("active", "passive", "experimental")
# Koşuyu "yeni ölçüm" yapabilen kartların `decision` değerleri (son inceleme I1: tek kaynak). D7 dünya kurulumu, D9 NPC hanesi / açılış geçişi / hane geliri, D10 iş piyasası akışları, D11 para devresi ve hayalet işletme.
# Sunucu işareti (`sim/plan.py`), kayıt yayını (`new_measurement` alanı) ve Sonuç ekranı aynı kümeyi kullanır.
NEW_MEASUREMENT_DECISIONS = ("D7", "D9", "D10", "D11")
KINDS = ("options", "toggle", "number", "fields", "order", "multi")
APPLIES = ("live", "live_sync", "start_only", "passive", "unknown")
CODEC_TYPES = ("enum", "bool", "number", "seed", "fields", "order", "multi")
UNITS = ("yuzde", "yuzde_hafta", "akce", "hafta", "kat", "oran", "sayi")
ACTORS = ("hane", "girisimci", "isci", "yatirimci", "yerlesik", "dunya")
CREDIT_TYPES = ("kurulus", "genc", "dayanma", "buyume", "yatirim", "arge", "devir", "kopru", "konut", "medya")
MEASURED_WEEKS = (100, 200, 500)
# `kind` -> izinli codec türleri (kontrol türü codec'ten türetilir; ikisi çelişemez)
KIND_CODECS = {"options": ("enum", "seed", "bool"), "toggle": ("bool",), "number": ("number",),
               "fields": ("fields",), "order": ("order",), "multi": ("multi",)}
# `shows` (K1-ek): kartın yalnız gösterdiği, ayarı olmayan model değerleri. Gizli kalibrasyon ve altyapı adları
# gösterilemez; yayımda parametre adı hiç çıkmaz (etiket `metinler.tr.json` `<kart>.shows.<etiket_anahtarı>`).
# `TRANS_*` gizli değildir (geçiş desteği oyuncunun gördüğü bir kuraldır).
HIDDEN_PARAMS = frozenset({"PM_ADJ", "MODEL_PARAMS", "WEEKLY_CSV", "VERSION", "REF_BASE", "STAGES", "TOPO0",
                           "RB_SCALE", "KK_MEAS"})
HIDDEN_PATTERNS = (re.compile(r"_CAL$"), re.compile(r"^DBG_"), re.compile(r"^DEBUG"), re.compile(r"_MEAS$"),
                   re.compile(r"_CSV$"))
PERCENT_UNITS = ("yuzde", "yuzde_hafta")
SHOWS_FIELDS = ("key", "label_key", "unit", "scale")
_LABEL_KEY_RE = re.compile(r"^[A-Za-z0-9_]{1,40}$")
REASONS = ("unknown", "locked", "invalid", "passive", "unverified")


class RegistryError(ValueError):
    """Kayıt verisi (JSON) bozuk ya da tutarsız: yüklemede hata."""


@dataclass(frozen=True)
class FieldError:
    id: str
    reason: str


class RunConfigError(ValueError):
    """Koşu yapılandırması geçersiz; `.errors` alan hatalarını taşır."""

    def __init__(self, errors: list[FieldError]):
        super().__init__(", ".join(f"{e.id}:{e.reason}" for e in errors))
        self.errors = errors


@dataclass
class Resolved:
    params: dict[str, Any] = field(default_factory=dict)
    passive_ids: list[str] = field(default_factory=list)
    errors: list[FieldError] = field(default_factory=list)


@dataclass(frozen=True)
class SettingDef:
    id: str
    layer: str
    group: str
    level: str
    editable: bool
    status: str
    kind: str
    params: tuple[str, ...]
    requires: tuple[str, ...]
    codec: dict
    apply: str
    decision: str | None = None
    source_world_field: str | None = None
    actor: str | None = None
    measured_at: Any = None             # bir arayüz değeri ya da arayüz değerleri listesi (list değerli kartlarda bkz. loader)
    measured_with: dict | None = None   # {kart: arayüz değeri} ya da {"_sablon": şablon kimliği}
    measured_weeks: int | None = None
    hint_source: str | None = None
    credit_type: str | None = None
    scenario_editable: bool = False
    default: Any = None                 # yalnız `params` boş kartlar için arayüz varsayılanı
    shows: tuple = ()                   # salt okunur satırlar: ({key, label_key?, unit?, scale?}, ...)
    effective_when: dict = field(default_factory=dict)   # V kartı: yalnız bu P kartları bu değerdeyken işler ({kart: arayüz değeri})

    def structure(self) -> dict:
        """Kamusal yapı (geliştirici alanı `decision` yok)."""
        d = {
            "id": self.id, "layer": self.layer, "group": self.group, "actor": self.actor, "level": self.level,
            "editable": self.editable, "status": self.status, "kind": self.kind,
            "params": list(self.params), "requires": list(self.requires),
            "codec": self.codec, "apply": self.apply,
            "measured_at": self.measured_at, "measured_with": self.measured_with,
            "measured_weeks": self.measured_weeks, "hint_source": self.hint_source,
            "credit_type": self.credit_type, "scenario_editable": self.scenario_editable,
            "source_world_field": self.source_world_field,
        }
        if self.effective_when:
            d["effective_when"] = dict(self.effective_when)        # V kartı: yalnız bu P kartları bu değerdeyken işler
        return d


_REQUIRED = ("id", "layer", "group", "level", "editable", "status", "kind", "params", "codec", "apply")


def _check_number(sid: str, c: dict) -> None:
    for k in ("scale", "min", "max"):
        v = c.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise RegistryError(f"{sid}: number codec '{k}' sayı olmalı")
    if c["scale"] <= 0 or c["min"] > c["max"]:
        raise RegistryError(f"{sid}: number codec aralığı geçersiz")
    if "integer" in c and not isinstance(c["integer"], bool):
        raise RegistryError(f"{sid}: number codec 'integer' bool olmalı")
    st = c.get("step")
    if isinstance(st, bool) or not isinstance(st, (int, float)) or st <= 0:
        raise RegistryError(f"{sid}: number codec 'step' zorunlu ve pozitif olmalı")
    if c.get("unit") is not None and c["unit"] not in UNITS:
        raise RegistryError(f"{sid}: number codec 'unit' bilinmiyor ({c['unit']!r})")


def _check_items(sid: str, c: dict) -> None:
    items = c.get("items")
    if (not isinstance(items, list) or not items or not all(isinstance(x, str) and x for x in items)
            or len(set(items)) != len(items)):
        raise RegistryError(f"{sid}: {c['type']} codec 'items' boş/yinelenen/geçersiz")
    if not isinstance(c.get("param"), str) or not c["param"]:
        raise RegistryError(f"{sid}: {c['type']} codec 'param' eksik")


def _check_codec(sid: str, c: Any, nested: bool = False) -> None:
    if not isinstance(c, dict) or c.get("type") not in CODEC_TYPES:
        raise RegistryError(f"{sid}: codec türü geçersiz")
    t = c["type"]
    if nested and t not in ("enum", "bool", "number"):
        raise RegistryError(f"{sid}: fields içinde '{t}' codec kullanılamaz")
    if t == "enum":
        m = c.get("map")
        if not isinstance(m, dict) or not m or not all(isinstance(k, str) and k for k in m):
            raise RegistryError(f"{sid}: enum codec 'map' boş/geçersiz")
    elif t == "bool":
        if "on" not in c or "off" not in c or c["on"] == c["off"]:
            raise RegistryError(f"{sid}: bool codec 'on'/'off' eksik")
        if any(isinstance(c[k], str) for k in ("on", "off")):
            raise RegistryError(f"{sid}: bool codec 'on'/'off' dizge olamaz")
    elif t == "number":
        _check_number(sid, c)
    elif t in ("order", "multi"):
        _check_items(sid, c)
    elif t == "fields":
        fl = c.get("fields")
        if not isinstance(fl, list) or not fl:
            raise RegistryError(f"{sid}: fields codec 'fields' boş/geçersiz")
        keys, params = set(), set()
        for f in fl:
            if (not isinstance(f, dict) or not isinstance(f.get("key"), str) or not f["key"]
                    or not isinstance(f.get("param"), str) or not f["param"]):
                raise RegistryError(f"{sid}: fields alanı 'key'/'param' eksik")
            if f["key"] in keys or f["param"] in params:
                raise RegistryError(f"{sid}: fields içinde yinelenen anahtar/parametre")
            keys.add(f["key"])
            params.add(f["param"])
            _check_codec(f"{sid}.{f['key']}", f.get("codec"), nested=True)


def codec_params(c: dict) -> list[str]:
    """Codec'in yazdığı model parametreleri (fields: alan parametreleri; order/multi: `param`)."""
    if c["type"] == "fields":
        return [f["param"] for f in c["fields"]]
    if c["type"] in ("order", "multi"):
        return [c["param"]]
    return []


def _opt_str(sid: str, raw: dict, k: str) -> str | None:
    v = raw.get(k)
    if v is not None and (not isinstance(v, str) or not v.strip()):
        raise RegistryError(f"{sid}: {k} dizge olmalı")
    return v


def _parse_shows(sid: str, raw: Any) -> tuple:
    if raw is None:
        return ()
    if not isinstance(raw, list) or not raw:
        raise RegistryError(f"{sid}: shows boş olmayan liste olmalı")
    out, seen = [], set()
    for e in raw:
        if not isinstance(e, dict) or set(e) - set(SHOWS_FIELDS):
            raise RegistryError(f"{sid}: shows girdisi yalnız {SHOWS_FIELDS} alanlarını taşıyabilir")
        key = e.get("key")
        if not isinstance(key, str) or not key.strip():
            raise RegistryError(f"{sid}: shows girdisinde 'key' eksik")
        if key in HIDDEN_PARAMS or any(r.search(key) for r in HIDDEN_PATTERNS):
            raise RegistryError(f"{sid}: shows '{key}' gösterilemez (gizli ad)")
        if key in seen:
            raise RegistryError(f"{sid}: shows içinde yinelenen anahtar '{key}'")
        seen.add(key)
        lk = e.get("label_key")
        if "label_key" in e and (not isinstance(lk, str) or not _LABEL_KEY_RE.match(lk)):
            raise RegistryError(f"{sid}: shows '{key}' label_key geçersiz")
        if "unit" in e and e["unit"] not in UNITS:
            raise RegistryError(f"{sid}: shows '{key}' unit bilinmiyor ({e['unit']!r})")
        if "scale" in e:
            sc = e["scale"]
            if isinstance(sc, bool) or not isinstance(sc, (int, float)) or not math.isfinite(sc) or sc <= 0:
                raise RegistryError(f"{sid}: shows '{key}' scale pozitif sayı olmalı")
        sc = e.get("scale", 1)
        if "unit" in e and (e["unit"] in PERCENT_UNITS) != (sc == 100) and (e["unit"] in PERCENT_UNITS or "scale" in e):
            raise RegistryError(f"{sid}: shows '{key}' yüzde birimi ile scale 100 birlikte olmalı")
        out.append(dict(e))
    return tuple(out)


def _parse_effective_when(sid: str, raw: Any) -> dict:
    if raw is None:
        return {}
    if (not isinstance(raw, dict) or not raw or not all(isinstance(k, str) and k and k != sid for k in raw)
            or any(isinstance(v, (list, dict, type(None))) for v in raw.values())):
        raise RegistryError(f"{sid}: effective_when {{kart: değer}} olmalı")
    return dict(raw)


def parse_setting(raw: Any, source: str) -> SettingDef:
    if not isinstance(raw, dict):
        raise RegistryError(f"{source}: kart nesne olmalı")
    sid = raw.get("id")
    if not isinstance(sid, str) or not sid:
        raise RegistryError(f"{source}: kimlik eksik")
    for k in _REQUIRED:
        if k not in raw:
            raise RegistryError(f"{sid}: '{k}' alanı eksik ({source})")
    if raw["layer"] not in LAYERS:
        raise RegistryError(f"{sid}: layer geçersiz")
    if raw["status"] not in STATUSES:
        raise RegistryError(f"{sid}: status geçersiz")
    if raw["kind"] not in KINDS:
        raise RegistryError(f"{sid}: kind geçersiz")
    if raw["apply"] not in APPLIES:
        raise RegistryError(f"{sid}: apply geçersiz")
    if not isinstance(raw["editable"], bool):
        raise RegistryError(f"{sid}: editable bool olmalı")
    for k in ("group", "level"):
        if not isinstance(raw[k], str) or not raw[k]:
            raise RegistryError(f"{sid}: {k} geçersiz")
    params, requires = raw["params"], raw.get("requires", list(raw["params"]))
    for name, lst in (("params", params), ("requires", requires)):
        if not isinstance(lst, list) or not all(isinstance(x, str) and x for x in lst):
            raise RegistryError(f"{sid}: {name} dizge listesi olmalı")
    if not params and raw["layer"] != "S":
        # istisna: edilemeyen kart. Pasif: modelde karşılığı yok (kilitli gösterilir). Etkin: modelde işleyen ama
        # ayarı olmayan kural (K1-ek; satırları `shows` ile gösterilir). Deneysel kart ayarsız olamaz.
        if raw["status"] not in ("passive", "active"):
            raise RegistryError(f"{sid}: params boş")
        if raw["editable"]:
            raise RegistryError(f"{sid}: params boş kart editable:false olmalı")
    swf = raw.get("source_world_field")
    if raw["layer"] == "S" and not swf:
        raise RegistryError(f"{sid}: S katmanı için source_world_field gerekli")
    _check_codec(sid, raw["codec"])
    c = raw["codec"]
    if c["type"] not in KIND_CODECS[raw["kind"]]:
        raise RegistryError(f"{sid}: kind '{raw['kind']}' ile codec '{c['type']}' uyuşmuyor")
    if raw["apply"] == "passive" and raw["status"] != "passive":
        raise RegistryError(f"{sid}: apply 'passive' yalnız pasif kartta")
    if params and c["type"] in ("fields", "order", "multi") and sorted(codec_params(c)) != sorted(params):
        raise RegistryError(f"{sid}: params ile codec parametreleri aynı olmalı")
    actor = raw.get("actor")
    if actor is not None and actor not in ACTORS:
        raise RegistryError(f"{sid}: actor geçersiz")
    ct = raw.get("credit_type")
    if ct is not None and ct not in CREDIT_TYPES:
        raise RegistryError(f"{sid}: credit_type geçersiz")
    se = raw.get("scenario_editable", False)
    if not isinstance(se, bool) or (se and raw["layer"] != "V"):
        raise RegistryError(f"{sid}: scenario_editable bool olmalı ve yalnız V katmanında true olabilir")
    mw = raw.get("measured_weeks")
    if mw is not None and (type(mw) is not int or mw not in MEASURED_WEEKS):
        raise RegistryError(f"{sid}: measured_weeks {MEASURED_WEEKS} içinden biri olmalı")
    mwith = raw.get("measured_with")
    if mwith is not None and (not isinstance(mwith, dict) or not mwith or not all(isinstance(k, str) for k in mwith)
                              or ("_sablon" in mwith and (len(mwith) != 1 or not isinstance(mwith["_sablon"], str)))):
        raise RegistryError(f"{sid}: measured_with {{kart: değer}} ya da {{\"_sablon\": kimlik}} olmalı")
    hs = _opt_str(sid, raw, "hint_source")
    if hs is not None and (hs.startswith("/") or ".." in hs.split("/") or "\\" in hs):
        raise RegistryError(f"{sid}: hint_source depo köküne göre göreli yol olmalı")
    if "measured_at" in raw and raw["measured_at"] is not None and raw["measured_at"] == []:
        raise RegistryError(f"{sid}: measured_at boş olamaz")
    return SettingDef(
        id=sid, layer=raw["layer"], group=raw["group"], level=raw["level"], editable=raw["editable"],
        status=raw["status"], kind=raw["kind"], params=tuple(params), requires=tuple(requires),
        codec=c, apply=raw["apply"], decision=raw.get("decision"), source_world_field=swf,
        actor=actor, measured_at=raw.get("measured_at"), measured_with=mwith, measured_weeks=mw,
        hint_source=hs, credit_type=ct, scenario_editable=se, default=raw.get("default"),
        shows=_parse_shows(sid, raw.get("shows")),
        effective_when=_parse_effective_when(sid, raw.get("effective_when")),
    )
