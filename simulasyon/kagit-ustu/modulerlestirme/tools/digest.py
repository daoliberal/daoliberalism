#!/usr/bin/env python3
"""digest.py: haftalık para hareketleri özeti (digest) ve iki model sürümünün ilk ıraksama haftası.

AMAÇ
  500 haftalık koşuyu beklemeden, iki model sürümünün (örn. taşıma öncesi/sonrası) hangi HAFTADA ve hangi
  İLK ÖDEMEDE ayrıştığını bulmak. model.py DEĞİŞTİRİLMEZ: model içe aktarılır (importlib), çalışma anında
  Ledger.pay / Ledger.__init__ ve modül düzeyi NOW listesi sarmalanır:
    * Ledger.pay    -> her çağrı (frm, to, istenen, gerçekleşen, tür) haftalık blake2b zincirine girer
    * Ledger.begin_week(w) -> hafta sınırı kancası (v12.3+; haftada tek kez; settle() haftada 7 kez çağrılır, işe yaramaz).
      Kanca yoksa (eski model) NOW listesi sarmalanır (yalnız tek dosyalı monolitte çalışır)
    * hafta sonu    -> L.bal.items() (sıra dahil), L.flows, L.minted, L.total() özetleri
  Raporun sha256'sı da kaydedilir (report() de koşulur; --no-report ile kapatılır).

KULLANIM
  digest.py record MODEL --weeks N [--cities C] [--params A=1,B=2] [--hashseed 0] [--ahir-kamu 1] -o OUT.jsonl
            [--ref REF.jsonl]            ref ile her hafta karşılaştır; ilk ıraksamada DUR (erken çıkış, çıkış kodu 3)
            [--dump-week W --dump-file F [--stop-after-dump]]   o haftanın tüm ödemelerini F'ye yaz
            [--no-report] [--report-out FILE]
  digest.py compare A.jsonl B.jsonl [--dump-a F --dump-b F]
      Başlıkları, ilk ıraksayan haftayı, farklı alanları ve tür bazında toplam farkını gösterir.
  digest.py diff MODEL_A MODEL_B --weeks N [aynı seçenekler] [--no-redump]
      İki modeli paralel koşar, karşılaştırır; ıraksama varsa o haftayı yeniden koşup İLK FARKLI ÖDEMEYİ bulur.

Ortam: PYTHONHASHSEED kayıt sırasında zorlanır (süreç yeniden başlatılır). Yalnız standart kütüphane.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import platform
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _common as C  # noqa: E402


# --------------------------------------------------------------------------- kayıt (çalışan süreç)
class Tracker:
    def __init__(self, ref=None, dump_week=None, dump_file=None, stop_after_dump=False, out=None):
        self.week = 0
        self.L = None
        self.reset()
        self.cum = hashlib.blake2b(digest_size=16)
        self.out = out
        self.ref = ref
        self.dump_week, self.dump_file, self.stop_after = dump_week, dump_file, stop_after_dump
        self.dump = []
        self.diverged = None
        self.rows = []

    def reset(self):
        self.h = hashlib.blake2b(digest_size=16)
        self.n = 0
        self.kind = {}

    def finalize(self):
        L = self.L
        week = self.week
        if self.n == 0 and L is None:
            return
        if L is not None:
            h16 = lambda x: hashlib.blake2b(repr(x).encode(), digest_size=16).hexdigest()
            bal, flows = h16(sorted(L.bal.items())), h16(sorted(L.flows.items()))             # değer düzeyi (sıradan bağımsız)
            bal_order, flows_order = h16(list(L.bal.items())), h16(list(L.flows.items()))     # sözlük SIRASI dahil (yumuşak alan)
            nbal, minted, total, ev = len(L.bal), repr(L.minted), repr(sum(L.bal.values())), len(L.events)
            cmx = dict(cm_mint=repr(L.cm_mint), cm_burn=repr(L.cm_burn), fiscal=repr(L.fiscal_minted), opening=repr(getattr(L, "opening", 0.0))) if hasattr(L, "fiscal_minted") else dict(cm_mint="", cm_burn="", fiscal="", opening="")      # K-218: kayıtlı para yaratımı/yakımı (kapalıyken 0)
        else:
            bal = flows = bal_order = flows_order = ""
            nbal = ev = 0
            minted = total = ""
            cmx = dict(cm_mint="", cm_burn="", fiscal="", opening="")
        hx = self.h.hexdigest()
        self.cum.update(hx.encode())
        row = dict(type="week", w=week, calls=self.n, hash=hx, cum=self.cum.hexdigest(), bal=bal, flows=flows,
                   bal_order=bal_order, flows_order=flows_order, nbal=nbal, minted=minted, total=total, events=ev,
                   kinds={k: repr(v) for k, v in self.kind.items()}, **cmx)
        self.rows.append(row)
        if self.out:
            self.out.write(json.dumps(row, ensure_ascii=False) + "\n")
            self.out.flush()
        if self.dump_week is not None and week == self.dump_week and self.dump_file:
            with open(self.dump_file, "w", encoding="utf-8") as f:
                f.write("\n".join(self.dump) + "\n")
            if self.stop_after:
                print(f"[digest] hafta {week} dökümü yazıldı, çıkılıyor", file=sys.stderr)
                os._exit(0)
        if self.ref is not None and week in self.ref:
            r = self.ref[week]
            diff = [k for k in ("calls", "hash", "bal", "flows", "nbal", "minted", "total", "events") if r.get(k) != row.get(k)]   # sert alanlar
            if diff and self.diverged is None:
                self.diverged = dict(type="diverged", w=week, fields=diff)
                if self.out:
                    self.out.write(json.dumps(self.diverged) + "\n")
                    self.out.flush()
                print(f"[digest] REF'TEN IRAKSADI: hafta {week}, alanlar {diff}", file=sys.stderr)
                os._exit(3)
        self.reset()
        self.dump = []

    def begin_week(self, w):
        self.finalize()
        self.week = w


def record(a):
    # PYTHONHASHSEED zorla: farklıysa süreci yeniden başlat
    if os.environ.get("PYTHONHASHSEED") != str(a.hashseed):
        env = dict(os.environ)
        env["PYTHONHASHSEED"] = str(a.hashseed)
        os.execve(sys.executable, [sys.executable] + sys.argv, env)
    for k in ("MODEL_PARAMS", "DBGF"):
        os.environ.pop(k, None)
    if a.params:
        os.environ["MODEL_PARAMS"] = a.params
    path = os.path.abspath(a.model)
    spec = importlib.util.spec_from_file_location("simmodel", path)
    m = importlib.util.module_from_spec(spec)
    sys.modules["simmodel"] = m
    spec.loader.exec_module(m)           # içe aktarma: yalnız sabitler ve tablolar kurulur, CLI çalışmaz (__main__ koruması)
    ref = None
    if a.ref:
        ref = {}
        for ln in open(a.ref, encoding="utf-8"):
            d = json.loads(ln)
            if d.get("type") == "week":
                ref[d["w"]] = d
    out = open(a.output, "w", encoding="utf-8") if a.output else None
    tr = Tracker(ref, a.dump_week, a.dump_file, a.stop_after_dump, out)
    cities = a.cities if a.cities is not None else m.CITIES
    if out:
        out.write(json.dumps(dict(type="header", model=path, model_sha256=C.sha256_file(path), version=getattr(m, "VERSION", "?"),
                                  weeks=a.weeks, cities=cities, params=a.params, hashseed=a.hashseed,
                                  python=platform.python_version(), ahir_kamu=a.ahir_kamu)) + "\n")
    Led = m.Ledger
    o_init, o_pay = Led.__init__, Led.pay

    def init(self, *args, **kw):
        o_init(self, *args, **kw)
        tr.L = self

    def pay(self, frm, to, amt, kind):
        r = o_pay(self, frm, to, amt, kind)
        tr.n += 1
        tr.h.update(f"{frm}\x1f{to}\x1f{amt!r}\x1f{r!r}\x1f{kind}\n".encode())
        tr.kind[kind] = tr.kind.get(kind, 0.0) + r
        if tr.dump_week is not None and tr.week == tr.dump_week:
            tr.dump.append(f"{tr.n}\t{frm}\t{to}\t{amt!r}\t{r!r}\t{kind}")
        return r
    Led.__init__, Led.pay = init, pay

    if hasattr(Led, "begin_week"):
        # v12.3+ (P0-2): hafta sınırı kancası; paket/sarmalayıcı yapısında da çalışır (sınıf nesnesi aynıdır)
        def begin_week(self, w):
            tr.begin_week(w)
        Led.begin_week = begin_week
    else:
        # eski modeller: NOW listesini yeniden atayarak (yalnız tek dosyalı monolitte çalışır)
        class WeekList(list):
            def __setitem__(self, i, v):
                super().__setitem__(i, v)
                if i == 0 or i == -1:
                    tr.begin_week(v)
        m.NOW = WeekList(m.NOW)
    o_run = m.run

    def run(*args, **kw):
        R = o_run(*args, **kw)
        tr.finalize()
        return R
    m.run = run
    m.AHIR_KAMU = bool(a.ahir_kamu)
    t0 = time.time()
    rep = None
    if a.no_report:
        run(a.weeks, cities)
    else:
        rep = (m.report(a.weeks, cities) + "\n").encode("utf-8")   # CLI'daki print() ile aynı bayt dizisi
        if a.report_out:
            open(a.report_out, "wb").write(rep)
    fin = dict(type="final", secs=round(time.time() - t0, 1), weeks_recorded=len(tr.rows))
    if rep is not None:
        fin.update(report_sha256=C.sha256_bytes(rep), report_body_sha256=C.sha256_bytes(C.body(rep)), report_lines=rep.count(b"\n"))
    if out:
        out.write(json.dumps(fin) + "\n")
        out.close()
    print(f"[digest] {len(tr.rows)} hafta kaydedildi, {fin['secs']} sn", file=sys.stderr)
    return 0


# --------------------------------------------------------------------------- karşılaştırma
def load(path):
    hdr, weeks, fin, div = {}, {}, {}, None
    for ln in open(path, encoding="utf-8"):
        d = json.loads(ln)
        t = d.get("type")
        if t == "header":
            hdr = d
        elif t == "week":
            weeks[d["w"]] = d
        elif t == "final":
            fin = d
        elif t == "diverged":
            div = d
    return hdr, weeks, fin, div


def first_dump_diff(fa, fb, ctx=2):
    A = open(fa, encoding="utf-8").read().split("\n")
    B = open(fb, encoding="utf-8").read().split("\n")
    for i in range(max(len(A), len(B))):
        la, lb = (A[i] if i < len(A) else "<yok>"), (B[i] if i < len(B) else "<yok>")
        if la != lb:
            return i, A[max(0, i - ctx):i + 1 + ctx], B[max(0, i - ctx):i + 1 + ctx]
    return None, [], []


def compare(a, quiet=False):
    ha, wa, fa, _ = load(a.a)
    hb, wb, fb, _ = load(a.b)
    p = print if not quiet else (lambda *x, **k: None)
    p(f"A: {ha.get('version')} sha {str(ha.get('model_sha256'))[:10]} hafta {ha.get('weeks')} params '{ha.get('params')}' tohum {ha.get('hashseed')}")
    p(f"B: {hb.get('version')} sha {str(hb.get('model_sha256'))[:10]} hafta {hb.get('weeks')} params '{hb.get('params')}' tohum {hb.get('hashseed')}")
    for k in ("weeks", "cities", "params", "hashseed", "ahir_kamu"):
        if ha.get(k) != hb.get(k):
            p(f"UYARI: başlık alanı farklı: {k}: {ha.get(k)} != {hb.get(k)}")
    common = sorted(set(wa) & set(wb))
    beh = ("calls", "hash", "bal", "flows", "nbal", "events")      # DAVRANIŞ alanları: ödeme zinciri, bakiyeler, akışlar
    num = ("minted", "total")                                        # SAYISAL (toplama sırası/son bit) alanları
    soft = ("bal_order", "flows_order")                              # yalnız sözlük sırası
    first_num = first_beh = first_soft = None
    for w in common:
        if first_soft is None and any(wa[w].get(k) != wb[w].get(k) for k in soft):
            first_soft = w
        if first_num is None and any(wa[w].get(k) != wb[w].get(k) for k in num):
            first_num = w
        if first_beh is None and any(wa[w].get(k) != wb[w].get(k) for k in beh):
            first_beh = w
    if first_soft is not None:
        p(f"not: hafta {first_soft}'den itibaren sözlük SIRASI farkı var (bal_order/flows_order); değerler ayrı denetlenir")
    res = dict(first_week=None, first_behavior_week=first_beh, first_numeric_week=first_num, first_order_week=first_soft)
    if first_beh is None and first_num is None:
        extra = ""
        if len(wa) != len(wb):
            extra = f" (uzunluk farkı: A {len(wa)} hafta, B {len(wb)} hafta)"
        same_rep = fa.get("report_sha256") == fb.get("report_sha256")
        p(f"AYNI: {len(common)} haftanın hepsinin özeti özdeş{extra}. Rapor sha256 {'aynı' if same_rep else 'FARKLI'} (ilk satır dahil).")
        if fa.get("report_body_sha256") and fb.get("report_body_sha256"):
            p(f"      rapor gövdesi (ilk satır hariç) {'aynı' if fa['report_body_sha256']==fb['report_body_sha256'] else 'FARKLI'}")
        return res
    if first_num is not None:
        w0 = first_num
        p(f"SAYISAL FARK (minted/total son bitleri; toplama sırası): ilk hafta {w0}: minted A {wa[w0]['minted']} / B {wb[w0]['minted']}")
    if first_beh is None:
        p("DAVRANIŞ ıraksaması YOK: ödeme zinciri, bakiyeler ve akışlar tüm haftalarda özdeş (yalnız sayısal son bit farkı)")
        res["first_week"] = first_num
        return res
    w = first_beh
    diff = [k for k in beh if wa[w].get(k) != wb[w].get(k)]
    res["first_week"] = w
    p(f"İLK DAVRANIŞ IRAKSAMASI: hafta {w}; farklı alanlar: {diff}")
    p(f"   çağrı sayısı A {wa[w]['calls']} / B {wb[w]['calls']}; minted A {wa[w]['minted']} / B {wb[w]['minted']}")
    ka, kb = wa[w]["kinds"], wb[w]["kinds"]
    rows = []
    for k in set(ka) | set(kb):
        x, y = float(ka.get(k, 0.0)), float(kb.get(k, 0.0))
        if ka.get(k) != kb.get(k):
            rows.append((abs(x - y), k, x, y))
    rows.sort(reverse=True)
    if w == 0:
        p("   (hafta 0 = kurulum: build() ve ilk settle)")
    if rows:
        p("   tür bazında toplam farkı (en büyük 8):")
        for d, k, x, y in rows[:8]:
            p(f"     {k:28} A {x:16.6f}  B {y:16.6f}  fark {x - y:+.6g}")
    else:
        p("   tür toplamları aynı (fark yalnız sıra/bakiye sözlüğü ya da son bitlerde olabilir)")
    if w - 1 in wa and w - 1 in wb:
        p(f"   önceki hafta ({w-1}) özdeş: ıraksama bu haftanın İÇİNDE başladı")
    if getattr(a, "dump_a", None) and getattr(a, "dump_b", None):
        i, ca, cb = first_dump_diff(a.dump_a, a.dump_b)
        if i is None:
            p("   döküm dosyaları özdeş (fark yalnız hafta sonu durumunda)")
        else:
            p(f"   İLK FARKLI ÖDEME: sıra {i + 1} (sütunlar: no, frm, to, istenen, gerçekleşen, tür)")
            p("   --- A ---")
            for l in ca:
                p("     " + l)
            p("   --- B ---")
            for l in cb:
                p("     " + l)
            res["first_call_index"] = i + 1
    return res


def diff(a):
    import tempfile
    from concurrent.futures import ThreadPoolExecutor
    tmp = tempfile.mkdtemp(prefix="digest_")
    common = ["--weeks", str(a.weeks), "--hashseed", str(a.hashseed), "--ahir-kamu", str(a.ahir_kamu)]
    if a.cities is not None:
        common += ["--cities", str(a.cities)]
    if a.params:
        common += ["--params", a.params]
    if a.no_report:
        common += ["--no-report"]

    def rec(model, out, extra=()):
        return subprocess.run([sys.executable, os.path.abspath(__file__), "record", model, *common, "-o", out, *extra],
                              capture_output=True, text=True)
    oa, ob = os.path.join(tmp, "a.jsonl"), os.path.join(tmp, "b.jsonl")
    t0 = time.time()
    with ThreadPoolExecutor(2) as ex:
        fa = ex.submit(rec, a.model_a, oa)
        fb = ex.submit(rec, a.model_b, ob)
        ra, rb = fa.result(), fb.result()
    for nm, r in (("A", ra), ("B", rb)):
        if r.returncode != 0:
            print(f"{nm} ÇÖKTÜ (rc {r.returncode}): {r.stderr.strip().splitlines()[-1:]}")
            return 2
    print(f"iki kayıt tamam ({time.time()-t0:.0f} sn); özetler {tmp}")
    ns = argparse.Namespace(a=oa, b=ob)
    res = compare(ns)
    w = res.get("first_week")
    if w is not None and not a.no_redump:
        da, db = os.path.join(tmp, f"a.dump{w}"), os.path.join(tmp, f"b.dump{w}")
        ex_args = ["--dump-week", str(w), "--stop-after-dump", "--no-report"]
        with ThreadPoolExecutor(2) as ex:
            f1 = ex.submit(rec, a.model_a, os.path.join(tmp, "a2.jsonl"), ex_args + ["--dump-file", da])
            f2 = ex.submit(rec, a.model_b, os.path.join(tmp, "b2.jsonl"), ex_args + ["--dump-file", db])
            f1.result(), f2.result()
        i, ca, cb = first_dump_diff(da, db)
        print(f"--- hafta {w} yeniden koşuldu ---")
        if i is None:
            print("ödeme dökümleri özdeş: fark yalnız hafta sonu bakiye/akış durumunda")
        else:
            print(f"İLK FARKLI ÖDEME: sıra {i + 1} (no, frm, to, istenen, gerçekleşen, tür)")
            print("--- A ---")
            [print("  " + l) for l in ca]
            print("--- B ---")
            [print("  " + l) for l in cb]
    return 1 if w is not None else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--weeks", type=int, default=8)
        p.add_argument("--cities", type=int, default=None)
        p.add_argument("--params", default="", help="MODEL_PARAMS biçimi: A=1,B=0.5")
        p.add_argument("--hashseed", type=int, default=0)
        p.add_argument("--ahir-kamu", type=int, default=1)
        p.add_argument("--no-report", action="store_true", help="report() koşma; yalnız run()")
    r = sub.add_parser("record")
    r.add_argument("model")
    common(r)
    r.add_argument("-o", "--output", default="")
    r.add_argument("--ref", default="")
    r.add_argument("--dump-week", type=int, default=None)
    r.add_argument("--dump-file", default="")
    r.add_argument("--stop-after-dump", action="store_true")
    r.add_argument("--report-out", default="")
    c = sub.add_parser("compare")
    c.add_argument("a")
    c.add_argument("b")
    c.add_argument("--dump-a", default="")
    c.add_argument("--dump-b", default="")
    d = sub.add_parser("diff")
    d.add_argument("model_a")
    d.add_argument("model_b")
    common(d)
    d.add_argument("--no-redump", action="store_true")
    a = ap.parse_args()
    if a.cmd == "record":
        sys.exit(record(a))
    if a.cmd == "compare":
        compare(a)
        sys.exit(0)
    sys.exit(diff(a))


if __name__ == "__main__":
    main()
