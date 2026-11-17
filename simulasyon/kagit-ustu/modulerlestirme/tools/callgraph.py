#!/usr/bin/env python3
"""callgraph.py: fonksiyon düzeyinde çağrı/başvuru grafı, DAG doğrulaması ve derinlik.

AMAÇ
  Katmanları elle tahmin etmek yerine çağrı grafından türetmek (plan v1'in katman iddiası kendi atamasıyla çelişiyordu).
  Düğümler: modül düzeyi fonksiyonlar (land, freight, prio_alloc ...), run() içindeki tüm iç fonksiyonlar (iç içe
  olanlar üst fonksiyona katlanır) ve rapor fonksiyonları. Kenar: A, B'nin adına başvuruyorsa (çağrı ya da argüman olarak).
  Çözümleme symtable ile yapılır: yerel ad/parametre B'yi gölgeliyorsa kenar sayılmaz.
  run() gövdesinin kendisi ("orkestrasyon") düğüm değildir; çağırdıkları ayrı listelenir.

ÇIKTI
  JSON: düğümler (tür, satır, derinlik, calls, called_by), SCC'ler (döngü varsa), derinlik histogramı.
  Derinlik: yaprak (başka düğüm çağırmayan) = 0; d(f) = 1 + max d(çağrılan). DAG ise döngüsüzdür ve derinlik doğal
  katmandır: bir modül yalnız daha düşük derinlikteki işlevlere bağımlı olacak biçimde gruplanırsa içe aktarma döngüsü olmaz.

KULLANIM
  callgraph.py MODEL.py [--json OUT.json] [--text OUT.txt] [--dot OUT.dot] [--include-report] [-q]
"""
import argparse
import ast
import collections
import json
import os
import symtable
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

sys.setrecursionlimit(10000)


def _tables(tab, acc=None):
    acc = {} if acc is None else acc
    for ch in tab.get_children():
        if ch.get_type() == "function":
            acc[(ch.get_name(), ch.get_lineno())] = ch
        _tables(ch, acc)
    return acc


def build_graph(path, include_report=False, entry="run"):
    src = C.read_source(path)
    tree = ast.parse(src)
    root = symtable.symtable(src, path, "exec")
    tabs = _tables(root)
    nodes = {}

    def add(name, node, kind):
        nodes[name] = dict(kind=kind, start=node.lineno, end=node.end_lineno, lines=node.end_lineno - node.lineno + 1, node=node)

    run = None
    for st in tree.body:
        if isinstance(st, ast.FunctionDef):
            if st.name == entry:
                run = st
            elif st.name.endswith("_report") or st.name in ("report", "K_cx_fund", "_gini", "_corr"):
                if include_report:
                    add(st.name, st, "report")
            else:
                add(st.name, st, "module")
    weekloop = None
    for st in run.body:
        if isinstance(st, ast.For) and isinstance(st.target, ast.Name) and st.target.id == "w":
            weekloop = st

    def runlevel(stmts, in_week):
        for st in stmts:
            if isinstance(st, ast.FunctionDef):
                add(st.name, st, "inner_week" if in_week else "inner")
                continue
            wk = in_week or st is weekloop
            for fld in ("body", "orelse", "finalbody"):
                sub = getattr(st, fld, None)
                if isinstance(sub, list) and sub and isinstance(sub[0], ast.stmt):
                    runlevel(sub, wk)
            for h in getattr(st, "handlers", []) or []:
                runlevel(h.body, wk)
    runlevel(run.body, False)
    names = set(nodes)
    for nm, d in nodes.items():
        tab = tabs.get((d["node"].name, d["node"].lineno))
        calls, refs = set(), set()
        callnames = {n.func.id for n in ast.walk(d["node"]) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        if tab is not None:
            # P2: lambda/genexpr (ve iç def) içindeki başvurular da ÜST işlevin başvurusudur (önceden kaçırılıyordu: yalnız doğrudan kapsam taranıyordu)
            def _scan(t):
                for s in t.get_symbols():
                    n2 = s.get_name()
                    if n2 in names and n2 != nm and s.is_referenced() and (s.is_free() or s.is_global()):
                        (calls if n2 in callnames else refs).add(n2)
                for ch in t.get_children():
                    _scan(ch)
            _scan(tab)
        d["calls"] = sorted(calls | refs)
        d["call_only"] = sorted(calls)
    # run() gövdesindeki doğrudan çağrılar (orkestrasyon)
    class RunBody(ast.NodeVisitor):
        def __init__(self):
            self.c = collections.Counter()

        def visit_FunctionDef(self, n):
            pass

        def visit_Name(self, n):
            if n.id in names and isinstance(n.ctx, ast.Load):
                self.c[n.id] += 1
    rb = RunBody()
    for st in run.body:
        rb.visit(st)
    for nm, d in nodes.items():
        d["called_by"] = []
    for nm, d in nodes.items():
        for c in d["calls"]:
            nodes[c]["called_by"].append(nm)
    # Tarjan
    idx, low, onst, stack, sccs, counter = {}, {}, set(), [], [], [0]

    def sc(v):
        idx[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        onst.add(v)
        for w in nodes[v]["calls"]:
            if w not in idx:
                sc(w)
                low[v] = min(low[v], low[w])
            elif w in onst:
                low[v] = min(low[v], idx[w])
        if low[v] == idx[v]:
            comp = []
            while True:
                w = stack.pop()
                onst.discard(w)
                comp.append(w)
                if w == v:
                    break
            if len(comp) > 1:
                sccs.append(sorted(comp))
    for v in nodes:
        if v not in idx:
            sc(v)
    # derinlik (döngü varsa SCC içi düğümler aynı derinlikte sayılır; kenar kaldırma yok, yalnız uyarı)
    depth = {}

    def dep(v, seen=()):
        if v in depth:
            return depth[v]
        if v in seen:
            return 0
        cs = [c for c in nodes[v]["calls"] if c not in seen and not any(v in s and c in s for s in sccs)]
        depth[v] = 0 if not cs else 1 + max(dep(c, seen + (v,)) for c in cs)
        return depth[v]
    for v in nodes:
        dep(v)
    for v, d in nodes.items():
        d["depth"] = depth[v]
    return dict(file=os.path.abspath(path), nodes=nodes, sccs=sccs, run_orchestration=dict(rb.c), run_lines=[run.lineno, run.end_lineno])


def to_json(G):
    out = dict(file=G["file"], is_dag=not G["sccs"], sccs=G["sccs"], run_orchestration=G["run_orchestration"], run_lines=G["run_lines"], nodes={})
    for k, d in G["nodes"].items():
        out["nodes"][k] = {x: d[x] for x in ("kind", "start", "end", "lines", "depth", "calls", "call_only", "called_by")}
    hist = collections.Counter(d["depth"] for d in G["nodes"].values())
    out["depth_histogram"] = {str(k): hist[k] for k in sorted(hist)}
    return out


def text_report(G):
    N = G["nodes"]
    o = []
    P = o.append
    P(f"# callgraph: {G['file']}")
    kinds = collections.Counter(d["kind"] for d in N.values())
    P(f"Düğüm: {len(N)} ({dict(kinds)}); kenar: {sum(len(d['calls']) for d in N.values())}")
    P(f"Döngü (SCC>1): {G['sccs'] if G['sccs'] else 'YOK -> graf bir DAG'}")
    hist = collections.defaultdict(list)
    for k, d in N.items():
        hist[d["depth"]].append(k)
    P("")
    P("## Derinlik (0 = yaprak). Katman = derinlik")
    for dp in sorted(hist):
        fs = sorted(hist[dp], key=lambda f: -N[f]["lines"])
        P(f"  derinlik {dp}: {len(fs)} işlev, {sum(N[f]['lines'] for f in fs)} satır  -> {', '.join(fs[:16])}{'…' if len(fs) > 16 else ''}")
    P("")
    P("## En çok çağrılan 15 (fan-in)")
    for k, d in sorted(N.items(), key=lambda x: -len(x[1]["called_by"]))[:15]:
        P(f"  {k:18} {len(d['called_by']):3} çağıran, derinlik {d['depth']}, {d['lines']} satır")
    P("")
    P("## En çok bağımlı 12 (fan-out)")
    for k, d in sorted(N.items(), key=lambda x: -len(x[1]["calls"]))[:12]:
        P(f"  {k:18} {len(d['calls']):3} bağımlılık, derinlik {d['depth']}")
    P("")
    P(f"## run() gövdesinin (orkestrasyon) doğrudan kullandığı {len(G['run_orchestration'])} düğüm")
    P("  " + ", ".join(sorted(G["run_orchestration"], key=lambda x: -G["run_orchestration"][x])[:40]) + "…")
    ro = {k for k in N if k not in G["run_orchestration"] and not N[k]["called_by"]}
    P(f"## Hiç çağrılmayan/başvurulmayan düğümler (ölü kod adayı): {sorted(ro)}")
    return "\n".join(o) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model")
    ap.add_argument("--json", default="")
    ap.add_argument("--text", default="")
    ap.add_argument("--dot", default="")
    ap.add_argument("--include-report", action="store_true")
    ap.add_argument("-q", action="store_true")
    a = ap.parse_args()
    G = build_graph(a.model, a.include_report)
    if a.json:
        json.dump(to_json(G), open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if a.dot:
        with open(a.dot, "w") as f:
            f.write("digraph G {\n rankdir=LR;\n")
            for k, d in G["nodes"].items():
                f.write(f' "{k}" [label="{k}\\nd{d["depth"]}"];\n')
                for c in d["calls"]:
                    f.write(f' "{k}" -> "{c}";\n')
            f.write("}\n")
    t = text_report(G)
    if a.text:
        open(a.text, "w", encoding="utf-8").write(t)
    if not a.q:
        sys.stdout.write(t)


if __name__ == "__main__":
    main()
