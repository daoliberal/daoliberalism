"""PLAN-KREDI T3 (B6): kuruluş haftasında ölen oyuncu işletmelerinin kök neden tanısı. SALT OKUR: model değişmez, koşu ortamına yazılmaz.

Sahibin tarifiyle (ya da verilen geçersiz kılmalarla) N hafta koşulur; `simkit.step.PHASES` fazları `week_step` yerine TEK TEK çağrılır ve her fazdan sonra
o hafta kurulan her oyuncu işletmesi için kurucunun `workers`'tan ÇIKTIĞI faz ve kişinin yeni durumu kaydedilir:
  is_ariyor      kurucu iş arayan listesinde (`seekers`)
  baska_firma    kurucu başka bir firmada çalışıyor
  sehir_degisti  kurucu başka şehre geçti
  kayip          hiçbiri (işgücü dışı ya da kayıt dışı)
Fazın `L.events` satırlarından kurucuyu ya da işletmeyi anan "YETMEDİ" ödeme-yetersizliği satırları ayrıca yazılır.

Fazların tek tek çağrısı `week_step` ile özdeş olmak zorundadır; `--kontrol` ikinci bir koşuyla (aynı tohum, düz `week_step`) `wk_csv`, `L.flows`, `L.events`
ve `L.bal` eşitliğini doğrular.

Kullanım (sunucu dizininden):
    python3 -P tools_tani_kurucu.py --tarif sahip --hafta 26 --kontrol
    python3 -P tools_tani_kurucu.py --tarif varsayilan --hafta 26 --ek '{"FOUND_WEEK":1,"FOUND_HARC":0,"FOUND_WORKED":1,"FOUND_BUF":1.0}'
"""
from __future__ import annotations

import argparse
import inspect
import json
import os
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# `simkit.step.week_step` gövdesindeki çağrı imzaları (faz adı -> argümanlar). Çalışırken `PHASES` adlarıyla karşılaştırılır.
PHASE_ARGS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("phase_begin_week", ("W", "w")),
    ("phase_policy", ("W", "w")),
    ("phase_prices", ("W", "w")),
    ("phase_wages", ("W", "w")),
    ("phase_migration", ("W", "w")),
    ("phase_staffing", ("W", "w")),
    ("phase_founding", ("W", "w")),
    ("phase_domestic", ("W", "w")),
    ("phase_cycle_setup", ("W",)),
    ("phase_cycles", ("W", "w", "weeks")),
    ("phase_house_rent", ("W",)),
    ("phase_credit", ("W", "w")),
    ("phase_deposits", ("W", "w")),
    ("phase_dividends", ("W", "w")),
    ("phase_innov_end", ("W", "w")),
    ("phase_metrics", ("W", "w", "weeks")),
    ("phase_gates", ("W", "w", "weeks")),
    ("phase_close", ("W", "w")),
)
STATES = ("is_ariyor", "baska_firma", "sehir_degisti", "kayip")
SEED = 20261106


def classify_state(*, firm: str | None, fname: str, seeking: bool, moved: bool) -> str:
    """Kurucunun işletmeden ayrıldıktan sonraki durumu."""
    if firm is not None and firm != fname:
        return "baska_firma"
    if moved:
        return "sehir_degisti"
    if seeking:
        return "is_ariyor"
    return "kayip"


def _check_phases(step_mod) -> list[Callable]:
    names = [f.__name__ for f in step_mod.PHASES]
    want = [n for n, _ in PHASE_ARGS]
    if names != want:
        raise RuntimeError(f"PHASES sırası değişmiş: {names} != {want}")
    for f, (_n, args) in zip(step_mod.PHASES, PHASE_ARGS):
        params = tuple(inspect.signature(f).parameters)
        if params != args:
            raise RuntimeError(f"{f.__name__} imzası değişmiş: {params} != {args}")
    return list(step_mod.PHASES)


class Tracker:
    """Her fazdan sonra çağrılır; kuruluş haftasındaki oyuncu işletmelerini ve kurucularını izler."""

    def __init__(self, W, tier0: float = 0.0):
        self.tier0 = tier0                                                   # `TIER_WAGE[0]`: modelin kuruluşta yeni çalışan için varsaydığı ücret
        self.n_firms = len(W.firms)
        self.firms: dict[str, dict[str, Any]] = {}
        self.ev_seen = len(W.L.events)
        self.week = -1
        self.dao = set()

    def observe(self, W, w: int, phase: str) -> None:
        firms, people, ev = W.firms, W.people, W.L.events
        new_ev = ev[self.ev_seen:]
        self.ev_seen = len(ev)
        if len(firms) > self.n_firms:                                        # firmalar sözlüğü yalnız büyür (ölüler silinmez)
            for name in list(firms)[self.n_firms:]:
                d = firms[name]
                if d.get("owner") is not None and d["kind"] != "arge" and d.get("born") == w:
                    self.firms[name] = dict(week=w, name=name, kind=d["kind"], city=d["city"], owner=d["owner"], born_phase=phase, left_phase=None,
                                            state=None, yetmedi=[], dead_phase=None, died_week=None, owner_firm=None,
                                            cash0=round(W.L.bal[name], 2), wage=people[d["owner"]]["wage"], wage_model=self.tier0, wi=round(W.WI[d["city"]], 3), role=people[d["owner"]].get("role"), tier=people[d["owner"]].get("tier"))
            self.n_firms = len(firms)
        for name, r in self.firms.items():
            if r["week"] != w or (r["left_phase"] is not None and r["dead_phase"] is not None):
                continue
            d = firms[name]
            q = r["owner"]
            if r["left_phase"] is None and phase != r["born_phase"] and q not in d["workers"]:
                p = people[q]
                seeking = any(q in c["seekers"] for c in W.cities)
                moved = p.get("city") is not None and p.get("city") != d["city"]
                r["left_phase"] = phase
                r["state"] = classify_state(firm=p["firm"], fname=name, seeking=seeking, moved=moved)
                r["owner_firm"] = p["firm"]
                pat = re.compile(r"(?<!\w)(%s|%s)(?!\w)" % (re.escape(q), re.escape(name)))
                r["yetmedi"] = [e for e in new_ev if "YETMEDİ" in e and pat.search(e)][:3]
            if r["dead_phase"] is None and d.get("dead"):
                r["dead_phase"], r["died_week"] = phase, d.get("died")


def _drive(host, tracker: Tracker | None) -> None:
    """`host._week_step`i faz faz çağıran işlevle değiştirir (host.step kancaları ve ortam temizliği aynen çalışır)."""
    step = host._mods["simkit.step"]
    phases = _check_phases(step)

    def week_step(W, w, weeks):
        env = {"W": W, "w": w, "weeks": weeks}
        for f, (_n, args) in zip(phases, PHASE_ARGS):
            f(*[env[a] for a in args])
            if tracker is not None:
                tracker.observe(W, w, f.__name__)
    host._week_step = week_step


def _signature(host) -> dict[str, Any]:
    W = host._W
    return {"wk_csv": [dict(r) for r in W.wk_csv], "flows": dict(W.L.flows), "events": list(W.L.events), "bal": dict(W.L.bal)}


def _diff(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    out = []
    for k in a:
        if a[k] != b[k]:
            if isinstance(a[k], list):
                n = next((i for i, (x, y) in enumerate(zip(a[k], b[k])) if x != y), min(len(a[k]), len(b[k])))
                out.append(f"{k}: ilk fark #{n} (uzunluk {len(a[k])} / {len(b[k])})")
            else:
                keys = [x for x in set(a[k]) | set(b[k]) if a[k].get(x) != b[k].get(x)][:3]
                out.append(f"{k}: fark {keys}")
    return out


def run(overrides: dict[str, Any], weeks: int, seed: int = SEED, check: bool = False, progress: bool = False) -> dict[str, Any]:
    """`weeks` hafta faz faz koşar. `check` açıksa aynı tohumla düz `week_step` koşusu da yapılır ve eşitlik denetlenir."""
    from oyun_server import config
    from oyun_server.sim.host import ModelHost

    random.seed(seed)
    host = ModelHost(str(config.MODEL_ROOT), dict(overrides), 200)
    try:
        tracker = Tracker(host._W, float(host._P.TIER_WAGE[0]))
        _drive(host, tracker)
        for i in range(weeks):
            host.step()
            if progress:
                print(f"  hafta {i + 1}/{weeks}", file=sys.stderr, flush=True)
        sig_a = _signature(host) if check else None
        W = host._W
        for r in tracker.firms.values():                                     # koşu sonunda kesin ölüm haftası (ölüler silinmez)
            d = W.firms[r["name"]]
            r["dead"] = bool(d.get("dead"))
            r["died_week"] = d.get("died") if d.get("dead") else None
        rows = list(tracker.firms.values())
        phases = [n for n, _ in PHASE_ARGS]
    finally:
        host.close()
    res: dict[str, Any] = {"rows": rows, "phases": phases, "weeks": weeks, "equal": None, "diff": []}
    if check:
        random.seed(seed)
        host = ModelHost(str(config.MODEL_ROOT), dict(overrides), 200)
        try:
            for _ in range(weeks):
                host.step()
            sig_b = _signature(host)
        finally:
            host.close()
        res["diff"] = _diff(sig_a, sig_b)
        res["equal"] = not res["diff"]
    return res


def summarize(res: dict[str, Any]) -> dict[str, Any]:
    rows = res["rows"]
    same_week = [r for r in rows if r.get("dead") and r.get("died_week") == r["week"]]
    died = [r for r in rows if r.get("dead")]
    by_phase: dict[str, Counter] = defaultdict(Counter)
    for r in rows:
        if r["left_phase"] is not None:
            by_phase[r["left_phase"]][r["state"]] += 1
    sw_phase: dict[str, Counter] = defaultdict(Counter)
    for r in same_week:
        sw_phase[r["left_phase"] or "-"][r["state"] or "-"] += 1
    left = [r for r in rows if r["left_phase"] is not None]
    ratio = sorted(r["wage"] / r["wage_model"] for r in rows if r.get("wage_model"))
    roles: dict[str, Counter] = {}
    for r in rows:
        roles.setdefault(str(r.get("role")), Counter())["ayrildi" if r["left_phase"] is not None else "kaldi"] += 1
    return {"rol_durum": {k: dict(v) for k, v in roles.items()}, "ucret_orani_medyan": round(ratio[len(ratio) // 2], 2) if ratio else None,
            "ayrilan_ilk_ucret_yetmedi": sum(1 for r in left if r["yetmedi"] and r["yetmedi"][0].startswith("YETMEDİ ucret")),
            "yeni": len(rows), "oldu": len(died), "kurulus_haftasinda_oldu": len(same_week),
            "kurucu_haftada_ayrildi": sum(1 for r in rows if r["left_phase"] is not None),
            "yetmedi_satirli": sum(1 for r in rows if r["yetmedi"]),
            "faz_durum": {p: dict(c) for p, c in by_phase.items()}, "ayni_hafta_olum_faz_durum": {p: dict(c) for p, c in sw_phase.items()}}


def render(res: dict[str, Any]) -> str:
    s = summarize(res)
    lines = [f"Kuruluş haftası kök neden tanısı ({res['weeks']} hf): {s['yeni']} yeni oyuncu işletmesi, {s['oldu']} ölü, {s['kurulus_haftasinda_oldu']} kuruluş haftasında ölü.",
             f"Kurucu kuruluş haftasında işletmeden ayrıldı: {s['kurucu_haftada_ayrildi']}; ayrılışı anan YETMEDİ satırı olan: {s['yetmedi_satirli']}.", "",
             "| Kurucunun ayrıldığı faz | is_ariyor | baska_firma | sehir_degisti | kayip | toplam | bunlardan kuruluş haftasında ölen |", "|---|---|---|---|---|---|---|"]
    for p in res["phases"]:
        c = s["faz_durum"].get(p)
        if not c:
            continue
        sw = sum(s["ayni_hafta_olum_faz_durum"].get(p, {}).values())
        lines.append(f"| {p} | " + " | ".join(str(c.get(k, 0)) for k in STATES) + f" | {sum(c.values())} | {sw} |")
    lines += ["", f"Kurucunun gerçek ücreti / kuruluşta sermayeye girilen ücret (`TIER_WAGE[0]`) medyanı: {s['ucret_orani_medyan']}; ayrılanlardan ilk YETMEDİ satırı ücret olan: "
              f"{s['ayrilan_ilk_ucret_yetmedi']} / {s['kurucu_haftada_ayrildi']}."]
    lines += ["", "Kurucunun rolüne göre (kuruluş haftasında ayrılan / kalan): " + "; ".join(f"{k}: {v.get('ayrildi', 0)} / {v.get('kaldi', 0)}" for k, v in sorted(s["rol_durum"].items()))]
    if res["equal"] is not None:
        lines += ["", "Faz faz çağrı = `week_step` (wk_csv, L.flows, L.events, L.bal): " + ("ÖZDEŞ" if res["equal"] else "FARKLI: " + "; ".join(res["diff"]))]
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tarif", choices=("sahip", "varsayilan"), default="sahip")
    ap.add_argument("--hafta", type=int, default=26)
    ap.add_argument("--kontrol", action="store_true", help="düz week_step koşusuyla eşitliği de doğrula (süre ikiye katlanır)")
    ap.add_argument("--ek", default="{}", help='ek geçersiz kılmalar (JSON), örn. \'{"FOUND_WORKED": 1}\' (kuruluş kapılarını gevşetmek için)')
    ap.add_argument("--json", help="ham satırları bu dosyaya yaz (git dışı bir yol verin)")
    a = ap.parse_args(argv)
    os.environ.setdefault("PYTHONHASHSEED", "0")
    if a.tarif == "sahip":
        from tests.test_holdings_para import owner_recipe_overrides
        overrides = owner_recipe_overrides()
    else:
        overrides = {}
    overrides.update(json.loads(a.ek))
    res = run(overrides, a.hafta, check=a.kontrol, progress=True)
    print(render(res))
    if a.json:
        Path(a.json).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0 if res["equal"] in (None, True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
