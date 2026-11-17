"""Çözümleme: arayüz değerleri -> tipli model parametreleri; koşu yapılandırması -> geçersiz kılmalar."""
from __future__ import annotations

from typing import Any

from ..sim import nufus
from .loader import Registry
from .schema import FieldError, Resolved, RunConfigError

DURATIONS = (100, 200, 500, 520)   # izinli koşu süreleri (hafta); 520 = DAO oyunu (K-231). Model son hafta işlerini koşunun kendi süresinde yapar (M6)
DEFAULT_DURATION = 200
GOALS = ("alive", "serve", "kasa", "gini")


def run_editable(card: Any) -> bool:
    """Şart değeri (`values`) ve canlı yamayla değişebilen kart: düzenlenebilir ve V katmanı değil (DK-9: dünyanın
    insanları yalnız dünya senaryosu / şablon `world_values` yoluyla değişir)."""
    return card.editable and card.layer != "V"


def resolve(reg: Registry, values: Any, world: bool = False) -> Resolved:
    """Yalnız editable:true, etkin kimlikler. Herhangi bir hata varsa `params` boş döner (atomik).
    `passive` kartlar hata olarak bildirilir ve `passive_ids`'e de yazılır. `world=False` (Şart değerleri, canlı yama):
    V kartları `locked`; `world=True` yalnız dünya senaryosu çözümünde."""
    res = Resolved()
    if not isinstance(values, dict):
        res.errors.append(FieldError("values", "invalid"))
        return res
    params: dict[str, Any] = {}
    for sid, raw in values.items():
        s = reg.by_id.get(sid) if isinstance(sid, str) else None
        if s is None:
            res.errors.append(FieldError(str(sid), "unknown"))
        elif not s.editable or (s.layer == "V" and not world):
            res.errors.append(FieldError(sid, "locked"))
        elif s.status == "passive":
            res.passive_ids.append(sid)
            res.errors.append(FieldError(sid, "passive"))
        else:
            try:
                v = reg.decode(s, raw)
            except (ValueError, TypeError):
                res.errors.append(FieldError(sid, "invalid"))
                continue
            if isinstance(v, dict):                      # fields: her alan kendi parametresine yazılır
                params.update(v)
            else:
                for p in s.params:
                    params[p] = v
    if not res.errors:
        res.params = params
    return res


def _check_world(reg: Registry, config: dict, errors: list[FieldError], tw: dict | None = None) -> dict[str, Any]:
    """Dünya senaryosu: kimlik `senaryolar.json`'da olmalı; `worldScenarioValues` yalnız `scenario_editable` V kartları.
    Senaryonun kendi değerleri < `worldScenarioValues`. Çözülmüş model parametreleri döner (hata varsa boş)."""
    wid, wvals = config.get("worldScenarioId"), config.get("worldScenarioValues")
    vals: dict[str, Any] = {}
    if wid is not None:
        sc = next((x for x in reg.scenarios if x["id"] == wid), None) if isinstance(wid, str) else None
        if sc is None:
            errors.append(FieldError("worldScenarioId", "invalid"))
        else:
            for cid in sc["values"]:                          # senaryo değerleri de DK-17 kapısından geçer: doğrulanmamış kart başlatılamaz
                cc = reg.by_id.get(cid)
                if cc is not None and cc.apply == "unknown":
                    errors.append(FieldError(cid, "unverified"))
            vals.update(sc["values"])
    for tid_, tval in (tw or {}).items():                # şablonun dünya varsayımları: senaryo < şablon < kullanıcı dünya değerleri
        tc = reg.by_id.get(tid_)
        if tc is None:
            errors.append(FieldError(str(tid_), "unknown"))
        elif tc.apply == "unknown":
            errors.append(FieldError(tid_, "unverified"))
        elif tc.editable:
            vals[tid_] = tval
        else:                                             # loader yalnız düzenlenebilir V kartını kabul eder; bu dal savunmadır
            errors.append(FieldError(tid_, "locked"))
    if wvals is not None:
        if not isinstance(wvals, dict):
            errors.append(FieldError("worldScenarioValues", "invalid"))
        else:
            bad = False
            for sid in wvals:
                card = reg.by_id.get(sid) if isinstance(sid, str) else None
                if card is None or card.layer != "V" or not card.scenario_editable:
                    errors.append(FieldError(str(sid), "locked"))
                    bad = True
                elif card.apply == "unknown":
                    errors.append(FieldError(sid, "unverified"))
                    bad = True
            if not bad:
                vals.update(wvals)
    if errors:
        return {}
    if not vals:
        return {}
    r = resolve(reg, vals, world=True)
    if r.errors:
        errors.extend(r.errors)
        return {}
    return dict(r.params)


def check_goals(config: dict, errors: list[FieldError]) -> None:
    g = config.get("goals")
    if g is not None and (not isinstance(g, list) or not all(isinstance(x, str) and x in GOALS for x in g)
                          or len(set(g)) != len(g)):
        errors.append(FieldError("goals", "invalid"))


def run_overrides(reg: Registry, config: Any) -> dict[str, Any]:
    """Dünya senaryosu < şablon değerleri < kullanıcı değerleri; `seedIndex` -> dunya_tohumu (PM_ADJ).
    Geçersizse RunConfigError. `apply:"unknown"` kart başlangıçta da reddedilir (`unverified`)."""
    if not isinstance(config, dict):
        raise RunConfigError([FieldError("config", "invalid")])
    errors: list[FieldError] = []
    dw = config.get("durationWeeks")
    if type(dw) is not int or dw not in DURATIONS:
        errors.append(FieldError("durationWeeks", "invalid"))
    check_goals(config, errors)
    tid0 = config.get("templateId")
    world = _check_world(reg, config, errors, reg.templates[tid0]["world_values"] if isinstance(tid0, str) and tid0 in reg.templates else None)
    vals: dict[str, Any] = {}
    tid = config.get("templateId")
    if tid is not None:
        if tid not in reg.templates:
            errors.append(FieldError("templateId", "unknown"))
        else:
            vals.update(reg.templates[tid]["values"])
    user = config.get("values", {})
    if not isinstance(user, dict):
        errors.append(FieldError("values", "invalid"))
        user = {}
    vals.update(user)
    for sid in vals:
        card = reg.by_id.get(sid) if isinstance(sid, str) else None
        if card is not None and card.layer == "V":
            errors.append(FieldError(sid, "locked"))             # V yalnız dünya senaryosu / şablon dünya değerleriyle (DK-9)
        elif card is not None and card.apply == "unknown" and card.editable:
            errors.append(FieldError(sid, "unverified"))
    if "seedIndex" in config:
        si = config["seedIndex"]
        if type(si) is not int or not 0 <= si < len(reg.seeds):
            errors.append(FieldError("seedIndex", "invalid"))
        elif "dunya_tohumu" in user and user["dunya_tohumu"] != si:
            errors.append(FieldError("dunya_tohumu", "invalid"))
        else:
            vals["dunya_tohumu"] = si
    if errors:
        raise RunConfigError(errors)
    r = resolve(reg, vals)
    if r.errors:
        raise RunConfigError(r.errors)
    out = {**world, **r.params}
    if nufus.too_big(out, reg.defaults):             # D4: işçi süre/bellek üst sınırı (kart aralıklarının üstünde; aralık genişlerse devreye girer)
        raise RunConfigError([FieldError("sehir_basina_oyuncu", "too_big")])
    return out
