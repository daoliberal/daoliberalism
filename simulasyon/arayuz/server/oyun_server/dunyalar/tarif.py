"""Paylaşılan tarif (web `SharedRecipe`, `apps/web/src/oyun/sim/recipe.ts`) -> sunucu koşu `config` + `schedule`.

Eşleme (recipeToConfig ile aynı): templateId, durationWeeks, seedIndex, values, worldScenarioId, worldScenarioValues,
goals doğrudan `config`'e; `schedule` ayrı. Ad ve şehir adları tarifte yok, çağıran verir. Doğrulama `runs/recipe.py`'dedir.
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any

from ..registry.loader import Registry
from ..runs import recipe as run_recipe
from ..security import HttpError

TARIF_SURUMU = 1
MAX_JSON = 16 * 1024
_KIMLIK = re.compile(r"[A-Za-z0-9_.-]{1,64}")
_HEDEFLER = ("alive", "serve", "kasa", "gini")
_ISTEK = ("worldScenarioId", "worldScenarioValues", "goals")


def _int(x: Any, lo: int, hi: int) -> bool:
    return type(x) is int and lo <= x <= hi


def _gecersiz(alanlar: list[tuple[str, str]]) -> HttpError:
    return HttpError(422, "invalid_config", "Koşu ayarları geçersiz.", [{"id": i, "reason": r} for i, r in alanlar])


def temizle(tarif: Any) -> dict:
    """Biçimi doğrular, yalnız bilinen alanları alır (depoya temiz tarif girer). Geçersizse `invalid_config` (422)."""
    if not isinstance(tarif, dict):
        raise _gecersiz([("config", "invalid")])
    try:
        if len(json.dumps(tarif, ensure_ascii=False)) > MAX_JSON:
            raise _gecersiz([("config", "invalid")])
    except (TypeError, ValueError, RecursionError):
        raise _gecersiz([("config", "invalid")])
    bad = []
    if tarif.get("v") != TARIF_SURUMU or type(tarif.get("v")) is not int:
        bad.append(("v", "invalid"))
    t = tarif.get("templateId")
    if not isinstance(t, str) or not _KIMLIK.fullmatch(t):
        bad.append(("templateId", "invalid"))
    if not _int(tarif.get("durationWeeks"), 1, 1000):
        bad.append(("durationWeeks", "invalid"))
    if not _int(tarif.get("seedIndex"), 0, 99):
        bad.append(("seedIndex", "invalid"))
    if not isinstance(tarif.get("values"), dict):
        bad.append(("values", "invalid"))
    w = tarif.get("worldScenarioId")
    if "worldScenarioId" in tarif and (not isinstance(w, str) or not _KIMLIK.fullmatch(w)):
        bad.append(("worldScenarioId", "invalid"))
    if "worldScenarioValues" in tarif and not isinstance(tarif["worldScenarioValues"], dict):
        bad.append(("worldScenarioValues", "invalid"))
    g = tarif.get("goals")
    if "goals" in tarif and not (isinstance(g, list) and len(g) <= len(_HEDEFLER) and all(isinstance(x, str) and x in _HEDEFLER for x in g)):
        bad.append(("goals", "invalid"))
    s = tarif.get("schedule")
    if "schedule" in tarif and not (isinstance(s, list) and len(s) <= run_recipe.MAX_SCHEDULE):
        bad.append(("schedule", "invalid"))
    elif isinstance(s, list):
        for i, e in enumerate(s):
            if not isinstance(e, dict) or not _int(e.get("week"), 1, 1000):
                bad.append(("schedule[%d].week" % i, "invalid"))
            if not isinstance(e, dict) or not isinstance(e.get("patch"), dict) or not e["patch"]:
                bad.append(("schedule[%d].patch" % i, "invalid"))
    if bad:
        raise _gecersiz(bad)
    out: dict = {"v": TARIF_SURUMU, "templateId": t, "durationWeeks": tarif["durationWeeks"],
                 "seedIndex": tarif["seedIndex"], "values": tarif["values"]}
    for k in _ISTEK:
        if k in tarif:
            out[k] = tarif[k]
    if tarif.get("schedule"):
        out["schedule"] = [{"week": e["week"], "patch": e["patch"]} for e in tarif["schedule"]]
    return out


def tariften_kosu(tarif: dict, ad: str, sehir_adlari: list[str], sure_hafta: int | None = None) -> dict:
    """`{"config": {...}, "schedule": [...]}`: `RunManager.create(config, schedule)` girdisi. `sure_hafta` verilirse
    `durationWeeks`'i geçersiz kılar (DAO oyunu 520). Tarif önceden `temizle`'den geçmiş olmalı."""
    config: dict = {"name": ad, "cityNames": list(sehir_adlari), "templateId": tarif["templateId"],
                    "durationWeeks": sure_hafta if sure_hafta is not None else tarif["durationWeeks"],
                    "seedIndex": tarif["seedIndex"], "values": copy.deepcopy(tarif["values"])}
    for k in _ISTEK:
        if k in tarif:
            config[k] = copy.deepcopy(tarif[k])
    return {"config": config, "schedule": [{"week": e["week"], "patch": copy.deepcopy(e["patch"])} for e in tarif.get("schedule", [])]}


def dogrula(reg: Registry, tarif: Any, live_keys: Any = None) -> dict:
    """Yayın anı: biçim + `runs/recipe.validate` (kendi süresiyle). Temiz tarifi döner; hata `invalid_config` 422."""
    t = temizle(tarif)
    kosu = tariften_kosu(t, "-", ["-"] * 5)
    errors = run_recipe.validate(reg, kosu, live_keys)
    if errors:
        raise _gecersiz([(e.id, e.reason) for e in errors])
    return t
