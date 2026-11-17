#!/usr/bin/env python3
"""gate.py: tek komutlu kabul kapısı (plan K0-K3'ün sürücüsü).

AMAÇ
  Her taşıma adımında elle zincir yerine tek komut: aday modeli (modüler sarmalayıcı ya da model.py) şu sırayla sınar:
    1. golden check: seçilen katmanlarda (varsayılan fast) altın çıktıyla BAYT BAYT aynı mı (ilk satırda yalnız sürüm jetonu hariç)
    2. digest: N hafta (varsayılan 100) boyunca adayın haftalık ödeme zinciri ÖZETİ referans modelle (varsayılan ../model.py)
       aynı mı; ıraksarsa ilk haftayı ve ilk farklı ödemeyi `digest.py compare` ile yazar
    3. para korunumu: adayın her haftasında |Ledger.total() - Ledger.minted| ≈ 0 (göreli 1e-9)
    4. hız: aynı senaryo (varsayılan G0_h8) adayda ve referansta ardışık (paralel DEĞİL) ölçülür; oran raporlanır.
       Eşik (varsayılan %10) aşılırsa UYARI; --strict-speed ile çıkış kodu 1 (makine yüklüyken ölçüm gürültülüdür).
  Referans digest `modulerlestirme/.cache/` altında (model sha256 + hafta + params anahtarlı) önbelleğe alınır (git'e girmez).
  v13.0 (K-217): referans dondurulmuş v13.0 kopyasıydı; v13.1 (K-221): dondurulmuş v13.1 kopyası. v13.2 (M6): varsayılan REFERANS dondurulmuş v13.2 kopyasıydı. v13.3 (M8): varsayılan REFERANS dondurulmuş v13.3 kopyasıdır (`snapshot/v13.3/model_mod.py`); varsayılan altınlar v13.3 modülerinden üretilmiştir;
  KR_V130_* senaryoları v13.0 değerleriyle koşar ve dondurulmuş v13.0 ile, KR_V131_* v13.1 değerleriyle koşar ve dondurulmuş v13.1 ile, KR_V132_* v13.2 değerleriyle koşar ve dondurulmuş v13.2 ile sha eşit olmalıdır (eşdeğerlik denetimi).
  `--legacy`: referans orijinal `../model.py` (arşiv), aday v13 bayrakları eski değerlerine çekilerek (LEGACY_PARAMS) koşulur; v13 altınları atlanır.

KULLANIM
  gate.py [--candidate model_mod.py] [--self-check] [--reference snapshot/v13.3/model_mod.py] [--legacy] [--no-lint] [--tier fast[,mid]] [--digest-weeks 100] [--jobs 4]
          [--params A=1] [--no-golden] [--no-digest] [--no-speed] [--strict-speed] [--speed-scenario G0_h8] [--speed-limit 0.10]
  Çıkış kodu: 0 hepsi yeşil; 1 golden/digest/para korunumu başarısız (hız yalnız --strict-speed ile).
Yalnız standart kütüphane. Model dosyasına dokunulmaz.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as C  # noqa: E402

CACHE = os.path.join(C.ROOT, ".cache")
LEGACY_REF = os.path.join(os.path.dirname(C.ROOT), "model.py")                  # orijinal tek dosyalı model (arşiv): yalnız --legacy
DEFAULT_REF = os.path.join(C.ROOT, "snapshot", "v13.3", "model_mod.py")        # M8: dondurulmuş v13.3 kopyası (varsayılan referans)
LEGACY_PARAMS = ("NPC_KEEP=0.5,FOUND_COLLAT=0,WAGE_TAX=0,CORP_TAX=0,INFRA_CONT=0,SHRINK_FIRST=0,ORDER_BOOK=0,TRANS_SUPPORT=0,SECTOR_BOARD=0,"
                 "SB_ENTRY_PERSIST=0.02,ENTRY_OPEN=0,FOUND_FUND=0,YOUNG_KIT=0,"
                 "DEP_ROUTE=0,LAB_K=0.1,LAB_DOWN=0.3,BENEFIT_WEEKS=9999,STAFF_DEMAND=0,HIRE_CASH_GATE=0,"
                 "REVIVE_CAPITAL=0,PROMO_FREE=0,PROD_TIER=(1.0,1.3,1.6),ULC_BASE_AUTO=0,FOUNDER_DEFER=0")      # v13.0, v13.1, v13.2 ve v13.3 varsayılanlarının v12.3 değerleri: aday bunlarla orijinal model.py ile bayt bayt aynı olmalı
DEFAULT_CAND = os.path.join(C.ROOT, "model_mod.py")           # PK-5: varsayılan aday modüler sarmalayıcı (eskiden referansın kendisiydi)
REL = 1e-9


def run_digest(model, weeks, params, out, hashseed=0):
    cmd = [sys.executable, os.path.join(C.TOOLS, "digest.py"), "record", model, "--weeks", str(weeks), "--no-report",
           "--hashseed", str(hashseed), "-o", out]
    if params:
        cmd += ["--params", params]
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    p = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return p.returncode == 0, p.stderr.strip().splitlines()[-1:] or [""]


def load_weeks(path):
    hdr, rows = None, {}
    for ln in open(path, encoding="utf-8"):
        d = json.loads(ln)
        if d.get("type") == "header":
            hdr = d
        elif d.get("type") == "week":
            rows[d["w"]] = d
    return hdr, rows


def step_golden(a):
    cmd = [sys.executable, os.path.join(C.TOOLS, "golden.py"), "check", a.candidate, "--tier", a.tier, "--jobs", str(a.jobs)]
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True)
    lines = p.stdout.strip().splitlines()
    bad = [ln for ln in lines if ln.startswith(("FARKLI", "ÇÖKTÜ", "EKSİK"))]
    for ln in bad[:12]:
        print("   " + ln)
    ok = p.returncode == 0
    n = sum(1 for ln in lines if ln.startswith("AYNI"))
    print(f"[{'OK ' if ok else 'HATA'}] golden ({a.tier}): {n} senaryo aynı" + ("" if ok else f", {len(bad)} başarısız") + f" ({time.time()-t0:.0f} sn)")
    if not ok and p.stderr.strip():
        print("   " + p.stderr.strip().splitlines()[-1])
    return ok


def _ref_id(path):
    """Önbellek kimliği: model dosyasının sha256'sı; yanında simkit/ varsa (dondurulmuş kopya) onun içeriği de katılır (v13.0, v13.1 ve v13.2 kopyalarının model_mod.py'si aynıdır)."""
    import hashlib
    h = hashlib.sha256(open(path, "rb").read())
    sk = os.path.join(os.path.dirname(path), "simkit")
    if os.path.isdir(sk) and os.path.dirname(path) != C.ROOT:
        for fn in sorted(os.listdir(sk)):
            if fn.endswith(".py"):
                h.update(fn.encode())
                h.update(open(os.path.join(sk, fn), "rb").read())
    return h.hexdigest()[:16]


def step_digest(a):
    os.makedirs(CACHE, exist_ok=True)
    key = f"{_ref_id(a.reference)}_{a.digest_weeks}_{(a.params or 'default').replace(',', '+').replace('=', '-')}.jsonl"
    ref = os.path.join(CACHE, key)
    cand = os.path.join(CACHE, "cand_" + key)
    cparams = (LEGACY_PARAMS + ("," + a.params if a.params else "")) if a.legacy else a.params
    t0 = time.time()
    jobs = []
    if not os.path.exists(ref):
        jobs.append(("ref", a.reference, ref))
    jobs.append(("cand", a.candidate, cand))
    res = C.parallel(jobs, lambda j: run_digest(j[1], a.digest_weeks, a.params if j[0] == "ref" else cparams, j[2] + (".tmp" if j[0] == "ref" else "")), 2)
    for (tag, _m, path), (ok, err) in zip(jobs, res):
        if not ok:
            print(f"[HATA] digest ({tag}) koşusu çöktü: {err[0][:160]}")
            return False
        if tag == "ref":
            os.replace(path + ".tmp", path)
    ha, A = load_weeks(ref)
    hb, B = load_weeks(cand)
    div = None
    for w in sorted(set(A) | set(B)):
        ra, rb = A.get(w), B.get(w)
        if ra is None or rb is None or any(ra.get(k) != rb.get(k) for k in ("hash", "cum", "bal", "flows", "calls", "minted", "total", "kinds")):
            div = w
            break
    ok_d = div is None
    if ok_d:
        print(f"[OK ] digest: {len(B)} hafta özet özdeş (referans {ha['model_sha256'][:10]}, aday {hb['model_sha256'][:10]}) ({time.time()-t0:.0f} sn)")
    else:
        print(f"[HATA] digest: İLK IRAKSAMA hafta {div} ({time.time()-t0:.0f} sn); ayrıntı:")
        p = subprocess.run([sys.executable, os.path.join(C.TOOLS, "digest.py"), "compare", ref, cand], capture_output=True, text=True)
        for ln in p.stdout.strip().splitlines()[:14]:
            print("   " + ln)
    # para korunumu (adayın kendi satırlarından)
    worst, wk = 0.0, None
    for w, r in sorted(B.items()):
        m, t = float(r.get("minted", 0)) + float(r.get("opening") or 0), float(r.get("total", 0))      # M11: açılış stoku (devreden kazanç) basım değil; Σbakiye = açılış + basım
        d = abs(m - t) / max(1.0, abs(m))
        if d > worst:
            worst, wk = d, w
    ok_c = worst <= REL
    print(f"[{'OK ' if ok_c else 'HATA'}] para korunumu: en kötü göreli |total-minted| = {worst:.2e}" + ("" if wk is None else f" (hafta {wk})") + f"; eşik {REL:g}")
    # K-218: kayıtlı para yaratımı: her hafta toplam para değişimi = Δ(mali basım) + Δ(kredi basımı) - Δ(kredi yakımı) (kredi parası hata değil, kayıtlı akış)
    worst2, wk2, prev, n_cm = 0.0, None, 0.0, 0
    for w, r in sorted(B.items()):
        if r.get("fiscal", "") == "":
            continue
        t = float(r["total"])
        rec = float(r.get("opening") or 0) + float(r["fiscal"]) + float(r["cm_mint"]) - float(r["cm_burn"])      # M11: + açılış stoku (devreden kazanç)
        n_cm += float(r["cm_mint"]) > 0 or float(r["cm_burn"]) > 0
        d = abs(t - rec) / max(1.0, abs(t))
        if d > worst2:
            worst2, wk2 = d, w
        dt = t - prev
        prev = t
    ok_m = worst2 <= REL
    print(f"[{'OK ' if ok_m else 'HATA'}] para yaratımı kaydı: en kötü göreli |total - (açılış stoku + mali basım + kredi basımı - kredi yakımı)| = {worst2:.2e}" + ("" if wk2 is None else f" (hafta {wk2})") + f"; kredi parası etkin hafta sayısı {n_cm}")
    return ok_d and ok_c and ok_m


def step_cm(a):
    """K-218: kredi parası açıkken (CREDIT_MONEY=1) para yaratımı kayıtlı akıştır: her hafta total == minted ve total == mali basım + kredi basımı - kredi yakımı.
    Referansla özdeşlik beklenmez (para yaratımı davranışı değiştirir); yalnız adayın muhasebesi sınanır. Adayda CREDIT_MONEY yoksa (eski kopya) atlanır."""
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, f"cm_{os.path.basename(os.path.dirname(a.candidate))}_{a.cm_weeks}{'' if a.cm_params == 'CREDIT_MONEY=1' else '_' + a.cm_params.replace('=', '').replace(',', '_')}.jsonl")
    t0 = time.time()
    cmd = [sys.executable, os.path.join(C.TOOLS, "digest.py"), "record", a.candidate, "--weeks", str(a.cm_weeks), "--no-report", "--hashseed", "0", "-o", out, "--params", a.cm_params]
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    p = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if p.returncode != 0:
        last = (p.stderr.strip().splitlines() or [""])[-1]
        if "CREDIT_MONEY" in last:
            print("[ATLA] kredi parası denetimi: aday CREDIT_MONEY'i tanımıyor (K-218 öncesi kopya)")
            return True
        print(f"[HATA] kredi parası koşusu çöktü: {last[:160]}")
        return False
    _h, B = load_weeks(out)
    worst1 = worst2 = 0.0
    mint_w = 0
    last_mint = last_burn = 0.0
    for w, r in sorted(B.items()):
        t, m, op_ = float(r["total"]), float(r["minted"]) + float(r.get("opening") or 0), float(r.get("opening") or 0)
        worst1 = max(worst1, abs(t - m) / max(1.0, abs(m)))
        cm_m, cm_b, fis = float(r["cm_mint"]), float(r["cm_burn"]), float(r["fiscal"])
        worst2 = max(worst2, abs(t - (op_ + fis + cm_m - cm_b)) / max(1.0, abs(t)))
        mint_w += cm_m > last_mint
        last_mint, last_burn = cm_m, cm_b
    ok = worst1 <= REL and worst2 <= REL
    print(f"[{'OK ' if ok else 'HATA'}] kredi parası ({a.cm_params}, {len(B)} hf): |total-minted| {worst1:.2e}; |total-(mali basım+kredi basımı-yakım)| {worst2:.2e}; basım yapılan hafta {mint_w}; kümülatif basım {last_mint:,.0f}, yakım {last_burn:,.0f} ({time.time()-t0:.0f} sn)")
    return ok


def timed(model, sc, mf, reps):
    best = None
    for _ in range(reps):
        r = C.run_scenario(model, sc, mf.get("default_hashseed", 0))
        if not r["ok"]:
            return None
        best = r["secs"] if best is None else min(best, r["secs"])
    return best


def step_speed(a):
    mf = C.load_manifest()
    sc = next((s for s in mf["scenarios"] if s["id"] == a.speed_scenario), None)
    if sc is None:
        print(f"[HATA] hız senaryosu yok: {a.speed_scenario}")
        return False
    tr = timed(a.reference, sc, mf, a.speed_reps)
    if a.legacy:
        sc = dict(sc, params=dict(kv.split("=", 1) for kv in re.split(r",(?=[A-Z_0-9]+=)", LEGACY_PARAMS)))
    tc = timed(a.candidate, sc, mf, a.speed_reps)
    if tr is None or tc is None:
        print("[HATA] hız ölçümü: koşu çöktü")
        return False
    ratio = tc / tr - 1.0
    over = ratio > a.speed_limit
    print(f"[{'UYARI' if over else 'OK '}] hız ({a.speed_scenario}, en iyi {a.speed_reps}): referans {tr:.2f} sn, aday {tc:.2f} sn, fark {ratio*100:+.1f}% (eşik +{a.speed_limit*100:.0f}%)"
          + ("; makine yüklüyse gürültülü olabilir" if over else ""))
    return (not over) or (not a.strict_speed)


def step_lint():
    p = subprocess.run([sys.executable, os.path.join(C.TOOLS, "layer_lint.py"), "check", C.ROOT], capture_output=True, text=True)
    tail = [ln for ln in p.stdout.splitlines() if ln.startswith(("[HATA]", "SONUÇ"))]
    ok = p.returncode == 0
    print(f"[{'OK ' if ok else 'HATA'}] layer_lint (paket, rapor kapsamı dahil): " + (tail[-1] if tail else "?"))
    if not ok:
        for ln in tail[:8]:
            print("   " + ln)
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--candidate", default=DEFAULT_CAND, help="sınanacak model/sarmalayıcı (varsayılan: modulerlestirme/model_mod.py)")
    ap.add_argument("--self-check", action="store_true", help="aday = referans (kapının kendi kendine kontrolü; modüler kod SINANMAZ)")
    ap.add_argument("--no-lint", action="store_true", help="katman/döngü denetimini (layer_lint, paket modu) atla")
    ap.add_argument("--reference", default=DEFAULT_REF, help="referans model (varsayılan: dondurulmuş v13.3 kopyası)")
    ap.add_argument("--legacy", action="store_true", help="referans = orijinal ../model.py, aday v13 bayrakları eski değerlerde (LEGACY_PARAMS); v13 altınları atlanır")
    ap.add_argument("--tier", default="fast")
    ap.add_argument("--digest-weeks", type=int, default=100)
    ap.add_argument("--params", default="", help="digest koşuları için MODEL_PARAMS (A=1,B=2)")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--no-golden", action="store_true")
    ap.add_argument("--no-digest", action="store_true")
    ap.add_argument("--no-speed", action="store_true")
    ap.add_argument("--no-cm", action="store_true", help="K-218 kredi parası kayıt denetimini atla")
    ap.add_argument("--cm-weeks", type=int, default=80, help="K-218 denetimi için hafta sayısı (basımın başladığı haftalar için >= 70 önerilir)")
    ap.add_argument("--cm-params", default="CREDIT_MONEY=1", help="K-218 denetimi için MODEL_PARAMS (birleşik denetim: CREDIT_MONEY=1,TREASURY_RULE=1,PROFIT_KEEP=1,ENTRY_EXP=1,RATE_BEHAV=1)")
    ap.add_argument("--strict-speed", action="store_true")
    ap.add_argument("--speed-scenario", default="G0_h8")
    ap.add_argument("--speed-limit", type=float, default=0.10)
    ap.add_argument("--speed-reps", type=int, default=2)
    a = ap.parse_args()
    if a.legacy:
        a.reference = LEGACY_REF
        a.no_golden = True
    a.candidate, a.reference = os.path.abspath(a.candidate), os.path.abspath(a.reference)
    if a.self_check:
        a.candidate = a.reference
    if a.candidate == a.reference:
        print("UYARI: aday referansın kendisi: bu KENDİ KENDİNE KONTROL, modüler kod sınanmıyor (modüler kodu sınamak için --self-check vermeyin)")
    if not os.path.exists(os.path.join(C.ROOT, "golden", "G0_h8.md")):
        print("UYARI: altın .md dosyaları yok (git'e girmez): önce `python3 tools/golden.py make model_mod.py --tier fast,mid,long`")
    print(f"gate: aday {a.candidate} (sha256 {C.sha256_file(a.candidate)[:10]}), referans {a.reference}")
    ok = True
    if not a.no_golden:
        ok &= step_golden(a)
    if not a.no_digest:
        ok &= step_digest(a)
    if not a.no_cm and not a.legacy:
        ok &= step_cm(a)
    if not a.no_speed:
        ok &= step_speed(a)
    if not a.no_lint and os.path.basename(a.candidate) == "model_mod.py" and os.path.dirname(a.candidate) == C.ROOT:
        ok &= step_lint()
    print("GATE:", "YEŞİL" if ok else "KIRMIZI")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
