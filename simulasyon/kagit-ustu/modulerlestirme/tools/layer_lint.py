#!/usr/bin/env python3
"""layer_lint.py: modül atamasının katman/döngü denetimi ve katmanların çağrı grafından otomatik türetilmesi.

AMAÇ
  callgraph.py'nin fonksiyon grafı + bir "modül atama dosyası" (hangi işlev hangi modüle) verildiğinde:
    * atanmamış işlevleri, hiçbir işlevle eşleşmeyen girdileri, çift atamaları,
    * modül grafında içe aktarma DÖNGÜSÜNÜ (SCC),
    * bildirilmiş katmanlarda ihlalleri (kural: A modülü B'ye bağlıysa katman(A) > katman(B); aynı katman yasak),
    * topolojik düzeyden OTOMATİK türetilmiş katmanları (derive) raporlar.
  Plan v1'in katmanları elle yazılmıştı ve kendi atamasıyla çelişiyordu; v2'de katmanlar bu araçla üretilir ve denetlenir.

ATAMA DOSYASI (JSON)
  {"modules": {"credit_core": ["lendable_cash", "capex_*", ...], ...},      # '*' ile önek eşleşmesi
   "layers":  {"credit_core": 0, ...}}                                       # isteğe bağlı (derive üretir)

KULLANIM
  layer_lint.py check  MODEL ATAMA.json [--allow-same-layer] [--json OUT] [--scope inner,module,inner_week,report]
  layer_lint.py derive MODEL ATAMA.json [--emit OUT.json]   # katmanları modül grafından türetir ve yazar
  layer_lint.py auto   MODEL                                # yalnız işlev derinliğinden doğal katman tablosu
Çıkış kodu: check'te hata varsa 1.
"""
import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import callgraph as CG  # noqa: E402


def expand(assign, nodes):
    owner, unknown, dup = {}, [], []
    for mod, pats in assign["modules"].items():
        for p in pats:
            if p.endswith("*"):
                hit = [n for n in nodes if n.startswith(p[:-1])]
                explicit = False
            else:
                hit = [p] if p in nodes else []
                explicit = True
            if not hit:
                unknown.append((mod, p))
            for n in hit:
                if n in owner and owner[n] != mod:
                    if explicit:
                        dup.append((n, owner[n], mod))
                    continue                     # joker eşleşmesi ilk gelene gider; açık ad ise çift atama hatası
                owner.setdefault(n, mod)
    # açık adlar jokerden önce gelmeli: joker ile alınmış ama açık adla başka modülde listelenen işlevleri düzelt
    for mod, pats in assign["modules"].items():
        for p in pats:
            if not p.endswith("*") and p in nodes and owner.get(p) != mod and (p, owner.get(p), mod) not in dup:
                if not any(q.endswith("*") and p.startswith(q[:-1]) for q in assign["modules"].get(owner.get(p), [])):
                    dup.append((p, owner.get(p), mod))
                else:
                    owner[p] = mod
    return owner, unknown, dup


def module_graph(nodes, owner):
    edges = collections.defaultdict(lambda: collections.defaultdict(list))
    for f, d in nodes.items():
        if f not in owner:
            continue
        for c in d["calls"]:
            if c in owner and owner[c] != owner[f]:
                edges[owner[f]][owner[c]].append((f, c))
    return edges


def sccs_of(mods, edges):
    idx, low, on, st, res, i = {}, {}, set(), [], [], [0]

    def sc(v):
        idx[v] = low[v] = i[0]
        i[0] += 1
        st.append(v)
        on.add(v)
        for w in edges.get(v, {}):
            if w not in idx:
                sc(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], idx[w])
        if low[v] == idx[v]:
            comp = []
            while True:
                w = st.pop()
                on.discard(w)
                comp.append(w)
                if w == v:
                    break
            if len(comp) > 1:
                res.append(sorted(comp))
    for m in mods:
        if m not in idx:
            sc(m)
    return res


def auto_layers(mods, edges):
    """Modül grafından en uzun yol düzeyi: bağımlılığı olmayan = 0; düzey = 1 + max(bağımlı olduğu modüllerin düzeyi)."""
    lv = {}

    def f(m, seen=()):
        if m in lv:
            return lv[m]
        if m in seen:
            return 0
        deps = [d for d in edges.get(m, {}) if d not in seen]
        lv[m] = 0 if not deps else 1 + max(f(d, seen + (m,)) for d in deps)
        return lv[m]
    for m in mods:
        f(m)
    return lv


def check(a):
    G = CG.build_graph(a.model, "report" in a.scope)
    nodes = {k: d for k, d in G["nodes"].items() if d["kind"] in a.scope}
    assign = json.load(open(a.assign, encoding="utf-8"))
    owner, unknown, dup = expand(assign, nodes)
    errs = 0
    mods = list(assign["modules"])
    print(f"# layer_lint: {len(nodes)} işlev, {len(mods)} modül, atanan {len(owner)}")
    un = sorted(n for n in nodes if n not in owner)
    print(f"[{'HATA' if un else 'ok'}] atanmamış işlev: {len(un)} {un}")
    errs += bool(un)
    print(f"[{'HATA' if unknown else 'ok'}] hiçbir işlevle eşleşmeyen girdi: {unknown}")
    errs += bool(unknown)
    print(f"[{'HATA' if dup else 'ok'}] çift atama: {dup}")
    errs += bool(dup)
    edges = module_graph(nodes, owner)
    cyc = sccs_of(mods, edges)
    print(f"[{'HATA' if cyc else 'ok'}] modül grafında içe aktarma döngüsü: {cyc}")
    errs += bool(cyc)
    if G["sccs"]:
        print(f"[HATA] işlev grafında döngü: {G['sccs']}")
        errs += 1
    layers = assign.get("layers")
    viol = []
    if layers:
        miss = [m for m in mods if m not in layers]
        if miss:
            print(f"[HATA] katmanı bildirilmemiş modül: {miss}")
            errs += 1
        for a_, tg in edges.items():
            for b_, lst in tg.items():
                la, lb = layers.get(a_), layers.get(b_)
                if la is None or lb is None:
                    continue
                if la < lb or (la == lb and not a.allow_same_layer):
                    viol.append((a_, la, b_, lb, lst))
        print(f"[{'HATA' if viol else 'ok'}] bildirilmiş katman ihlali: {len(viol)}")
        for a_, la, b_, lb, lst in sorted(viol, key=lambda x: (x[1], x[0])):
            kind = "ALTTAN ÜSTE" if la < lb else "AYNI KATMAN"
            print(f"     {a_}(L{la}) -> {b_}(L{lb})  {kind}: {', '.join(f'{x}->{y}' for x, y in lst[:5])}{'…' if len(lst) > 5 else ''}")
        errs += bool(viol)
    lv = auto_layers(mods, edges)
    print("\n## Modül grafından otomatik katmanlar (düşük = temel)")
    size = collections.Counter()
    for f, m in owner.items():
        size[m] += nodes[f]["lines"]
    for m in sorted(mods, key=lambda x: (lv[x], x)):
        deps = sorted(edges.get(m, {}))
        dr = [nodes[f]["depth"] for f, mm in owner.items() if mm == m]
        print(f"  L{lv[m]} {m:14} {size[m]:5} satır(iç fn)  işlev derinliği {min(dr) if dr else '-'}–{max(dr) if dr else '-'}  -> {', '.join(deps)}")
    if a.json:
        json.dump(dict(errors=errs, unassigned=un, unknown=unknown, dup=dup, cycles=cyc, layer_violations=[(x[0], x[1], x[2], x[3]) for x in viol],
                       auto_layers=lv), open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\nSONUÇ:", "TEMİZ" if not errs else f"{errs} sınıf hata")
    return 1 if errs else 0


def derive(a):
    G = CG.build_graph(a.model, "report" in a.scope)
    nodes = {k: d for k, d in G["nodes"].items() if d["kind"] in a.scope}
    assign = json.load(open(a.assign, encoding="utf-8"))
    owner, unknown, dup = expand(assign, nodes)
    mods = list(assign["modules"])
    edges = module_graph(nodes, owner)
    cyc = sccs_of(mods, edges)
    if cyc:
        print("DÖNGÜ var, katman türetilemez:", cyc)
        return 1
    lv = auto_layers(mods, edges)
    out = dict(assign)
    out["layers"] = {m: lv[m] for m in sorted(mods, key=lambda x: (lv[x], x))}
    out["_derived"] = "layer_lint.py derive: katman = 1 + max(bağımlı olunan modüllerin katmanı); bağımlılığı olmayan 0"
    if a.emit:
        json.dump(out, open(a.emit, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("yazıldı:", a.emit)
    for m, l in out["layers"].items():
        print(f"  L{l} {m}")
    return 0


def auto(a):
    G = CG.build_graph(a.model, False)
    hist = collections.defaultdict(list)
    for k, d in G["nodes"].items():
        hist[d["depth"]].append(k)
    print(f"işlev grafı {'DAG' if not G['sccs'] else 'DÖNGÜLÜ ' + str(G['sccs'])}; doğal katman = çağrı derinliği")
    for dp in sorted(hist):
        print(f"  katman {dp}: {len(hist[dp])} işlev, {sum(G['nodes'][f]['lines'] for f in hist[dp])} satır")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for n in ("check", "derive", "auto"):
        p = sub.add_parser(n)
        p.add_argument("model", help="model dosyası ya da dizin (model_mod.py + simkit/ içeren klasör: paket modu)")
        if n != "auto":
            p.add_argument("assign", nargs="?", default=None, help="atama JSON (dizin modunda varsayılan atamalar/modules_v2.json)")
        p.add_argument("--scope", default=None, help="varsayılan: dosya için inner,module,inner_week; dizin (paket) için rapor kapsamı da dahil")
        if n == "check":
            p.add_argument("--allow-same-layer", action="store_true")
            p.add_argument("--json", default="")
        if n == "derive":
            p.add_argument("--emit", default="")
    a = ap.parse_args()
    if hasattr(a, "scope"):
        if a.scope is None:
            a.scope = "inner,module,inner_week,report" if os.path.isdir(a.model) else "inner,module,inner_week"
        a.scope = a.scope.split(",")
    if hasattr(a, "assign") and a.assign is None:
        a.assign = os.path.join(CG.C.ROOT, "atamalar", "modules_v2.json")
    sys.exit({"check": check, "derive": derive, "auto": auto}[a.cmd](a))


if __name__ == "__main__":
    main()
