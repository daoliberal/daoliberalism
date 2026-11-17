#!/usr/bin/env python3
"""golden.py: altın (golden) rapor üretme ve bayt bayt karşılaştırma.

AMAÇ
  Modülerleştirme sırasında davranışın bir ondalık basamak bile değişmediğini kanıtlamak. Senaryo matrisi
  (golden/manifest.json) her senaryo için hafta sayısı, MODEL_PARAMS, --cities, --ahir-kamu ve PYTHONHASHSEED
  tanımlar. Her koşu AYRI süreçte ve SABİT PYTHONHASHSEED ile yapılır (varsayılan 0).

KULLANIM
  golden.py make  MODEL_DOSYASI [--manifest M] [--tier fast,mid,long] [--only ID,ID] [--jobs 6] [--outdir golden/]
      Altınları üretir: golden/<id>.md + golden/SHA256SUMS.json (sha256 tam ve ilk satırsız gövde).
  golden.py check MODEL_DOSYASI [--manifest M] [--tier ...] [--only ...] [--jobs 6] [--strict-first-line]
      Aynı senaryoları adayla koşar, altınla karşılaştırır. İlk satır (sürüm) varsayılan olarak hariç tutulur.
      İlk farklı satırı gösterir; fark varsa çıkış kodu 1. Adayın çıktıları --keep DIR ile saklanabilir.
  golden.py list  [--manifest M]
      Senaryo tablosu.
  --include-broken: status=broken (çürümüş bayrak) senaryolarını da koşar; bunlar BEKLENEN olarak çökmelidir
      (check bunları "çöktü (beklenen)" diye raporlar; çökmezse "ÇÖKMEDİ" uyarısı: durum değişmiş demektir).

Paralellik en çok 6 süreç. Yalnız standart kütüphane. Model dosyasına dokunulmaz.
"""
import argparse
import datetime
import json
import os
import platform
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402


def _split(s):
    return [x for x in (s or "").split(",") if x]


def cmd_list(a):
    m = C.load_manifest(a.manifest)
    print(f"{'id':10} {'tier':5} {'hf':>4} {'şhr':>3} {'durum':7} parametreler / not")
    for sc in m["scenarios"]:
        p = C.params_str(sc.get("params"))
        print(f"{sc['id']:10} {sc.get('tier','fast'):5} {sc['weeks']:>4} {str(sc.get('cities','-')):>3} "
              f"{sc.get('status','ok'):7} {p[:60]}{'  # ' + sc['note'] if sc.get('note') else ''}")


def _sums_path(outdir):
    return os.path.join(outdir, "SHA256SUMS.json")


def cmd_make(a):
    m = C.load_manifest(a.manifest)
    scs = C.select(m, set(_split(a.tier)) or None, set(_split(a.only)) or None, a.include_broken)
    os.makedirs(a.outdir, exist_ok=True)
    sums = {}
    if os.path.exists(_sums_path(a.outdir)):
        sums = json.load(open(_sums_path(a.outdir), encoding="utf-8"))
    sums.setdefault("_meta", {})
    meta = sums["_meta"]
    msha = C.sha256_file(a.model)
    if meta.get("model_sha256") not in (None, msha) and not a.keep_meta:
        # kısmi üretim farklı bir modelden: karışık sürüm altınları oluşmasın
        if not a.allow_mixed:
            sys.exit(f"HATA: mevcut altınlar model {meta.get('model_sha256','')[:12]} ile üretilmiş, bu model {msha[:12]}. "
                     "Tümünü yeniden üretin ya da --allow-mixed verin (karışık sürüm altınları kaydedilir).")
    meta.update(model=os.path.abspath(a.model), model_sha256=msha, model_version=C.model_version(a.model),
                source_commit=a.source_commit or meta.get("source_commit", ""),
                python=platform.python_version(), created=datetime.datetime.now().isoformat(timespec="seconds"),
                default_hashseed=m.get("default_hashseed", 0))
    print(f"{len(scs)} senaryo üretilecek (≤{min(a.jobs, C.MAX_JOBS)} paralel), model sha256 {sums['_meta']['model_sha256'][:12]}")
    t0 = time.time()

    def work(sc):
        return C.run_scenario(a.model, sc, m.get("default_hashseed", 0), a.timeout)

    def prog(sc, r):
        print(f"  {sc['id']:10} {'tamam' if r['ok'] else 'ÇÖKTÜ':6} {r['secs']:6.1f} sn", flush=True)

    # uzun koşuları öne al (daha iyi paralel dağılım)
    order = sorted(scs, key=lambda s: -s["weeks"])
    res = dict(zip([s["id"] for s in order], C.parallel(order, work, a.jobs, prog)))
    bad = 0
    for sc in scs:
        r = res[sc["id"]]
        if not r["ok"]:
            bad += 1
            sums[sc["id"]] = dict(status="crash" if sc.get("status", "ok") != "ok" else "UNEXPECTED_CRASH",
                                  stderr_tail=r["err"].strip().splitlines()[-1:] or [""], rc=r["rc"])
            continue
        path = os.path.join(a.outdir, sc["id"] + ".md")
        with open(path, "wb") as f:
            f.write(r["out"])
        sums[sc["id"]] = dict(sha256=C.sha256_bytes(r["out"]), sha256_body=C.sha256_bytes(C.body(r["out"])),
                              bytes=len(r["out"]), lines=r["out"].count(b"\n"), secs=round(r["secs"], 1),
                              weeks=sc["weeks"], params=C.params_str(sc.get("params")), status="ok",
                              model_sha256=msha)
    with open(_sums_path(a.outdir), "w", encoding="utf-8") as f:
        json.dump(sums, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"bitti: {time.time()-t0:.0f} sn; çöken: {bad}. Özetler: {_sums_path(a.outdir)}")
    return 0


def cmd_check(a):
    m = C.load_manifest(a.manifest)
    scs = C.select(m, set(_split(a.tier)) or None, set(_split(a.only)) or None, a.include_broken)
    sums = json.load(open(_sums_path(a.golden), encoding="utf-8"))
    skip = not a.strict_first_line
    gm = sums.get("_meta", {})
    if gm.get("python") and gm["python"] != platform.python_version():
        print(f"UYARI: altınlar Python {gm['python']} ile üretildi, şimdi {platform.python_version()}: "
              "sürüm sapması (sum() telafili toplama) sahte fark üretebilir")
    print(f"altın kaynağı: commit {gm.get('source_commit','?')[:12]}, model sha256 {gm.get('model_sha256','?')[:12]}, "
          f"sürüm {gm.get('model_version','?')}")
    if a.keep:
        os.makedirs(a.keep, exist_ok=True)
    print(f"{len(scs)} senaryo karşılaştırılacak (≤{min(a.jobs, C.MAX_JOBS)} paralel); ilk satır "
          f"{'HARİÇ' if skip else 'DAHİL'}; model {C.sha256_file(a.model)[:12]}")

    def work(sc):
        return C.run_scenario(a.model, sc, m.get("default_hashseed", 0), a.timeout)

    order = sorted(scs, key=lambda s: -s["weeks"])
    results = dict(zip([s["id"] for s in order], C.parallel(order, work, a.jobs)))
    fails = 0
    for sc in scs:
        r = results[sc["id"]]
        sid = sc["id"]
        if sc.get("status", "ok") != "ok":
            if r["ok"]:
                print(f"UYARI  {sid:10} ÇÖKMEDİ ama 'broken' işaretli: durum değişmiş, manifesti güncelleyin")
            else:
                print(f"BEKLENEN {sid:10} çöktü: {(r['err'].strip().splitlines() or [''])[-1][:80]}")
            continue
        if not r["ok"]:
            fails += 1
            print(f"ÇÖKTÜ  {sid:10} {(r['err'].strip().splitlines() or [''])[-1][:100]}")
            continue
        if a.keep:
            open(os.path.join(a.keep, sid + ".md"), "wb").write(r["out"])
        gp = os.path.join(a.golden, sid + ".md")
        if not os.path.exists(gp):
            fails += 1
            print(f"EKSİK  {sid:10} altın dosya yok ({gp})")
            continue
        g = open(gp, "rb").read()
        same = C.body(g, skip) == C.body(r["out"], skip)
        if same:
            print(f"AYNI   {sid:10} {r['secs']:6.1f} sn  sha256(gövde) {C.sha256_bytes(C.body(r['out'], skip))[:12]}")
        else:
            fails += 1
            ok, ln, ga, gb = C.first_diff(g, r["out"], skip)
            col, wa, wb = C.window(ga, gb)
            print(f"FARKLI {sid:10} {r['secs']:6.1f} sn  ilk fark satır {ln}, sütun {col}")
            print(f"         altın : …{wa}")
            print(f"         aday  : …{wb}")
    print("SONUÇ:", "TÜMÜ AYNI" if not fails else f"{fails} senaryo başarısız")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("make", "check", "list"):
        p = sub.add_parser(name)
        if name != "list":
            p.add_argument("model", help="model.py ya da anlık görüntü dosyası")
        p.add_argument("--manifest", default=C.DEFAULT_MANIFEST)
        p.add_argument("--tier", default="", help="fast,mid,long (virgülle)")
        p.add_argument("--only", default="", help="senaryo kimlikleri (virgülle)")
        p.add_argument("--jobs", type=int, default=C.MAX_JOBS)
        p.add_argument("--timeout", type=float, default=None)
        p.add_argument("--include-broken", action="store_true")
        if name == "make":
            p.add_argument("--outdir", default=C.GOLDEN)
            p.add_argument("--source-commit", default="", help="altının üretildiği git commit sha'sı (manifeste yazılır)")
            p.add_argument("--allow-mixed", action="store_true", help="farklı model sha'lı altınların üzerine kısmi üretime izin ver")
            p.add_argument("--keep-meta", action="store_true", help=argparse.SUPPRESS)
        if name == "check":
            p.add_argument("--golden", default=C.GOLDEN, help="altın klasörü")
            p.add_argument("--strict-first-line", action="store_true", help="ilk (sürüm) satırı da karşılaştır")
            p.add_argument("--keep", default="", help="adayın çıktılarını bu klasöre kaydet")
    a = ap.parse_args()
    sys.exit({"make": cmd_make, "check": cmd_check, "list": cmd_list}[a.cmd](a) or 0)


if __name__ == "__main__":
    main()
