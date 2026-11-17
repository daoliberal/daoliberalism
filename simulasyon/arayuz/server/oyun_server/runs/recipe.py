"""Koşu tarifi (DK-11): `Recipe = {config, schedule: [{week, patch}]}`. HTTP yok; yalnız stdlib + kayıt.

`week` sürümün DİKİŞ haftasıdır (`ChangeResult.seamWeek` ile aynı): yama `week` haftası hesaplandıktan sonra, `week + 1`
öncesinde uygulanır. `week == 0` yamaları kuruluşa katılır (`start_only` anahtarlar yalnız burada serbest). Haftalar azalmaz
(aynı dikişte art arda iki yama olabilir: iki ayrı sürüm); `0 <= week < duration`.

Sözleşme notları:
- Takvim sürerken canlı değişiklik: ön yüklü yamaların sürüm numaraları baştan atanır; işçide hepsi uygulanana kadar canlı
  `changes` `busy` döner. Yamalar işçi hafta `week`'e ulaşınca (boştayken de) uygulanır; bu yüzden `ff` takvimin SON haftasına
  kadar verilen bir yeniden kurmada (kütüphane/yeniden kurma tüketicileri) canlı değişiklik hemen kabul edilir.
- Dal anlık görüntüdür: `branch(W)` ebeveynin O ANKİ tarifinin `week <= W` kısmını alır; ebeveyn W'ye gelmeden dallanılırsa
  ebeveynin sonradan W'den önce yaptığı değişiklikler dala girmez.
"""
from __future__ import annotations

import copy
from typing import Any

from ..registry.loader import Registry
from ..registry.resolve import DURATIONS, resolve, run_editable, run_overrides
from ..registry.schema import FieldError, RunConfigError

MAX_SCHEDULE = 500               # bir tarifte en çok yama sayısı (en uzun koşu süresi kadar)


def is_int(v: Any) -> bool:
    return type(v) is int


def shape_errors(schedule: Any) -> list[FieldError]:
    """Yalnız biçim: liste, her öğe `{week:int, patch:dict}`; hafta sırası/aralığı `validate`'te."""
    if schedule is None:
        return []
    if not isinstance(schedule, list) or len(schedule) > MAX_SCHEDULE:
        return [FieldError("schedule", "invalid")]
    out = []
    for i, e in enumerate(schedule):
        if not isinstance(e, dict) or not is_int(e.get("week")):
            out.append(FieldError("schedule[%d].week" % i, "invalid"))
        if not isinstance(e, dict) or not isinstance(e.get("patch"), dict) or not e.get("patch"):
            out.append(FieldError("schedule[%d].patch" % i, "invalid"))
    return out


def _block_reason(card: Any, live_keys: Any, locks: Any = frozenset()) -> str | None:
    from .manager import change_block_reason          # yükleme döngüsünü önlemek için gecikmeli
    return change_block_reason(card, live_keys, locks)


def validate(reg: Registry, recipe: Any, live_keys: Any = None) -> list[FieldError]:
    """Tarifin tüm hataları (boş = geçerli). Kimlikler: `config` alan hataları aynen; takvim için `schedule[i].week`
    ve `schedule[i].patch.<ayar>`; neden `invalid/locked/passive/unverified/start_only`. Haftalar azalmaz, her yama `resolve`
    geçer; `start_only` (canlı olmayan) ayar yalnız `week == 0`'da."""
    if not isinstance(recipe, dict) or not isinstance(recipe.get("config"), dict):
        return [FieldError("config", "invalid")]
    errors: list[FieldError] = []
    cfg = recipe["config"]
    schedule = recipe.get("schedule") or []
    errors += shape_errors(schedule)
    if errors:
        return errors
    dw = cfg.get("durationWeeks")
    duration = dw if is_int(dw) and dw in DURATIONS else None
    locks: Any = frozenset()                             # kuruluş bağlamı (hafta 0 yamaları dahil) canlı yamaya kapattığı parametreler
    try:
        merged, _rest = split_week0(cfg, schedule)
        from .manager import context_locks
        locks = context_locks(reg, run_overrides(reg, merged))
    except RunConfigError as e:
        # hafta 0 yamasından gelen hata (config kimliğiyle döner) takvim girdisine bağlanır: istemci bozuk girdiyi bilir
        src = {}
        for i, en in enumerate(schedule):
            if en["week"] == 0:
                for k in en["patch"]:
                    src[k] = i                              # sonraki girdi kazanır (split_week0 ile aynı)
        errors += [FieldError("schedule[%d].patch.%s" % (src[x.id], x.id), x.reason) if x.id in src else x for x in e.errors]
    if live_keys is None:
        from .. import config as server_config
        live_keys = server_config.load_live_keys(reg)
    prev = 0
    for i, e in enumerate(schedule):
        w = e["week"]
        if w < prev or w < 0 or (duration is not None and w >= duration):
            errors.append(FieldError("schedule[%d].week" % i, "invalid"))
            continue
        prev = w
        if w == 0:
            continue                                    # kuruluşa katılır: `run_overrides` yukarıda doğruladı
        for sid, raw in e["patch"].items():
            card = reg.by_id.get(sid) if isinstance(sid, str) else None
            fid = "schedule[%d].patch.%s" % (i, sid)
            if card is None or not run_editable(card):
                errors.append(FieldError(fid, "locked"))
                continue
            why = _block_reason(card, live_keys, locks)
            if why is not None:
                errors.append(FieldError(fid, why))
                continue
            if resolve(reg, {sid: raw}).errors:
                errors.append(FieldError(fid, "invalid"))
        if not any(x.id.startswith("schedule[%d]." % i) for x in errors) and not resolve(reg, e["patch"]).params:
            errors.append(FieldError("schedule[%d].patch" % i, "invalid"))
    return errors


def split_week0(config_: dict, schedule: list | None) -> tuple[dict, list[dict]]:
    """`(birleşik config, week > 0 yamalar)`: week 0 yamaları `config.values` üstüne sırayla yazılır (sonraki kazanır).
    `config.values` nesne değilse olduğu gibi bırakılır (`run_overrides` geçersiz der)."""
    merged = dict(config_)
    values = config_.get("values")
    base = dict(values) if isinstance(values, dict) else ({} if values is None else None)
    rest = []
    for e in schedule or []:
        if e["week"] == 0:
            if base is not None:
                base.update(e["patch"])
        else:
            rest.append({"week": e["week"], "patch": copy.deepcopy(e["patch"])})
    if base is not None and (base or "values" in config_):
        merged["values"] = base
    return merged, rest
