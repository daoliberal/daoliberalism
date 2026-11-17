#!/usr/bin/env python3
"""Prototip katalog çıkarıcı (K2): `Main.dc.html` salt okunur; yalnız stdlib.

Çıktı bir TASLAKtır (commit'lenmez): R1a–R1c veri girişinde kullanır. Kayıt verisine (settings.*.json,
metinler.tr.json) hiçbir şey yazmaz.

Kullanım:
    python3 -P katalog_cikar.py --json            # tüm taslak stdout'a
    python3 -P katalog_cikar.py --ozet            # yalnız sayımlar
    python3 -P katalog_cikar.py --prototip YOL    # başka bir kopya (varsayılan: apps/web/prototype/oyun/Main.dc.html)

Kaynaklar (prototip yöntemleri): catalogSrc (güncel, `|` ayrımlı satırlar), catalogSrcOld (denetimin okuduğu eski
katalog), bhvDefs (R(...) çağrıları), mktItems, crTypes, crCommonDefs, templates, scenarios, realWorld,
ruleAliases, profiles, multiDefs. Denetim 97 satırı `simulasyon/tasarim/prototip-1-ayar-denetimi.md` §1.1–§1.15
tablolarından okunur.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[4]                      # .../simulasyon/arayuz/registry/araclar/katalog_cikar.py -> depo kökü
PROTOTIP = REPO / "apps" / "web" / "prototype" / "oyun" / "Main.dc.html"
DENETIM = REPO / "simulasyon" / "tasarim" / "prototip-1-ayar-denetimi.md"
REF_README = REPO / "simulasyon" / "arayuz" / "ref" / "README.md"

CATALOG_FIELDS = ["name", "label", "level", "range", "default", "badge", "what", "effect", "hint"]
OLD_FIELDS = ["name", "level", "range", "default", "badge", "hint"]


# ---------------------------------------------------------------- JS değişmez ayrıştırıcısı (en küçük küme)
class JsParseError(ValueError):
    pass


_ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0", "\\": "\\", '"': '"', "'": "'", "/": "/"}


class JsLit:
    """Çift/tek tırnaklı dize, sayı, true/false/null, dizi, nesne (çıplak anahtarlı) ve basit çağrı ayrıştırır."""

    def __init__(self, s: str, i: int = 0):
        self.s, self.i = s, i

    def ws(self) -> None:
        s = self.s
        while self.i < len(s):
            c = s[self.i]
            if c.isspace():
                self.i += 1
            elif s.startswith("//", self.i):
                j = s.find("\n", self.i)
                self.i = len(s) if j < 0 else j
            elif s.startswith("/*", self.i):
                j = s.find("*/", self.i)
                self.i = len(s) if j < 0 else j + 2
            else:
                break

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while True:
            if self.i >= len(self.s):
                raise JsParseError("dize kapanmadı")
            c = self.s[self.i]
            if c == "\\":
                n = self.s[self.i + 1]
                if n == "u":
                    out.append(chr(int(self.s[self.i + 2:self.i + 6], 16)))
                    self.i += 6
                    continue
                out.append(_ESC.get(n, n))
                self.i += 2
                continue
            if c == q:
                self.i += 1
                return "".join(out)
            out.append(c)
            self.i += 1

    def value(self):
        self.ws()
        c = self.s[self.i]
        if c in "\"'":
            return self.string()
        if c == "[":
            self.i += 1
            arr = []
            while True:
                self.ws()
                if self.s[self.i] == "]":
                    self.i += 1
                    return arr
                arr.append(self.value())
                self.ws()
                if self.s[self.i] == ",":
                    self.i += 1
        if c == "{":
            self.i += 1
            obj = {}
            while True:
                self.ws()
                if self.s[self.i] == "}":
                    self.i += 1
                    return obj
                if self.s[self.i] in "\"'":
                    k = self.string()
                else:
                    m = re.compile(r"[A-Za-z_$][\w$]*").match(self.s, self.i)
                    if not m:
                        raise JsParseError(f"anahtar beklenirdi @{self.i}: {self.s[self.i:self.i + 40]!r}")
                    k = m.group(0)
                    self.i = m.end()
                self.ws()
                if self.s[self.i] != ":":
                    raise JsParseError(f"':' beklenirdi @{self.i}")
                self.i += 1
                obj[k] = self.value()
                self.ws()
                if self.s[self.i] == ",":
                    self.i += 1
        m = re.compile(r"-?\d+(?:\.\d+)?").match(self.s, self.i)
        if m:
            self.i = m.end()
            f = float(m.group(0))
            return int(f) if f.is_integer() and "." not in m.group(0) else f
        m = re.compile(r"[A-Za-z_$][\w$]*").match(self.s, self.i)
        if m and m.group(0) in ("true", "false", "null"):
            self.i = m.end()
            return {"true": True, "false": False, "null": None}[m.group(0)]
        raise JsParseError(f"değişmez beklenirdi @{self.i}: {self.s[self.i:self.i + 40]!r}")

    def args(self):
        """`(` sonrası: virgülle ayrılmış değerler, `)` ile biter."""
        out = []
        while True:
            self.ws()
            if self.s[self.i] == ")":
                self.i += 1
                return out
            out.append(self.value())
            self.ws()
            if self.s[self.i] == ",":
                self.i += 1


def method_body(text: str, name: str) -> str:
    m = re.search(r"^  " + re.escape(name) + r"\(\) \{\n", text, re.M)
    if not m:
        raise KeyError(f"prototipte {name}() bulunamadı")
    nxt = re.compile(r"^  [A-Za-z_]+\([^)]*\) \{", re.M).search(text, m.end())
    return text[m.end():nxt.start() if nxt else len(text)]


def array_after(body: str, marker: str):
    i = body.index(marker) + len(marker)
    j = body.index("[", i)
    p = JsLit(body, j)
    return p.value()


def pipe_rows(body: str):
    return [JsLit(f'"{m}"').string() for m in re.findall(r'^\s+"((?:[^"\\]|\\.)*)",?\s*$', body, re.M)]


# ---------------------------------------------------------------- yöntem çıkarıcılar
def groups_current(body: str):
    """catalogSrc(): `G(ad, giriş, üst, [satırlar])` çağrıları."""
    out = []
    for m in re.finditer(r"^      G\(", body, re.M):
        p = JsLit(body, m.end())
        name = p.value()
        p.ws(); p.i += 1
        intro = p.value()
        p.ws(); p.i += 1
        top = p.value()
        p.ws(); p.i += 1
        rows = p.value()
        out.append({"grup": name, "giris": intro, "ust": top, "satirlar": rows})
    return out


def catalog_current(text: str):
    rows = []
    for g in groups_current(method_body(text, "catalogSrc")):
        for r in g["satirlar"]:
            parts = r.split("|")
            if len(parts) != len(CATALOG_FIELDS):
                raise ValueError(f"catalogSrc satırı {len(parts)} alanlı: {r[:60]!r}")
            d = dict(zip(CATALOG_FIELDS, parts))
            d["grup"] = g["grup"]
            rows.append(d)
    return rows


def catalog_old(text: str):
    out = []
    body = method_body(text, "catalogSrcOld")
    for m in re.finditer(r'^      \[', body, re.M):
        p = JsLit(body, m.end() - 1)
        grup, satirlar = p.value()
        for r in satirlar:
            parts = r.split("|")
            if len(parts) != len(OLD_FIELDS):
                raise ValueError(f"catalogSrcOld satırı {len(parts)} alanlı: {r[:60]!r}")
            d = dict(zip(OLD_FIELDS, parts))
            d["grup"] = grup
            out.append(d)
    return out


def group_names_current(text: str):
    return [g["grup"] for g in groups_current(method_body(text, "catalogSrc"))]


def rule_aliases(text: str):
    body = method_body(text, "ruleAliases")
    return JsLit(body, body.index("{")).value()


def real_world(text: str):
    body = method_body(text, "realWorld")
    return JsLit(body, body.index("{")).value()


def profiles(text: str):
    body = method_body(text, "profiles")
    return JsLit(body, body.index("[")).value()


def scenarios(text: str):
    body = method_body(text, "scenarios")
    return JsLit(body, body.index("[")).value()


def cr_common(text: str):
    body = method_body(text, "crCommonDefs")
    return JsLit(body, body.index("[")).value()


def bhv_defs(text: str):
    """bhvDefs(): R(id, t, what, val, real, eff, opts?) çağrıları; aktör, world, consts, calib ayrımıyla."""
    body = method_body(text, "bhvDefs")
    actors, buckets = [], {"world": [], "consts": [], "calib": []}
    sections = [(m.start(), "actor", m.group(1), m.group(2))
                for m in re.finditer(r'\{ id: "(\w+)", name: "([^"]+)", rows: \[', body)]
    sections += [(m.start(), "bucket", m.group(1), "") for m in re.finditer(r"^    (world|consts|calib): \[", body, re.M)]
    sections.sort()
    keys = ["id", "t", "what", "val", "real", "eff", "opts"]
    for m in re.finditer(r'(?<![\w.])R\("', body):
        p = JsLit(body, m.start() + 2)
        d = dict(zip(keys, p.args()))
        o = d.pop("opts", None) or {}
        d.setdefault("real", "")
        d.setdefault("eff", "")
        d["alias"] = o.get("alias", [])
        d["extra"] = o.get("extra", "")
        d["badge"] = o.get("badge", "S")
        d["secenekler"] = {k: v for k, v in o.items() if k not in ("alias", "extra", "badge")}
        _, kind, ident, name = [x for x in sections if x[0] < m.start()][-1]
        if kind == "actor":
            a = next((x for x in actors if x["id"] == ident), None)
            if a is None:
                a = {"id": ident, "name": name, "rows": []}
                actors.append(a)
            a["rows"].append(d)
        else:
            buckets[ident].append(d)
    return {"actors": actors, **buckets}


def market_items(text: str):
    body = method_body(text, "mktItems")
    out = []
    for m in re.finditer(r'\{ key: "(\w+)", t: "([^"]+)", fmt: .*?, start: ("(?:[^"\\]|\\.)*"), how: ("(?:[^"\\]|\\.)*"), alias: (\[[^\]]*\]) \}', body):
        out.append({"key": m.group(1), "t": m.group(2), "start": JsLit(m.group(3)).value(),
                    "how": JsLit(m.group(4)).value(), "alias": JsLit(m.group(5)).value()})
    return out


def cr_types(text: str):
    body = method_body(text, "crTypes")
    starts = [m.start() for m in re.finditer(r'^      \{ id: "(\w+)", grp: ', body, re.M)]
    out = []
    for n, s in enumerate(starts):
        blk = body[s:starts[n + 1] if n + 1 < len(starts) else len(body)]
        head = re.match(r'\s*\{ id: "(\w+)", grp: "(\w)", name: ("(?:[^"\\]|\\.)*")', blk)
        d = {"id": head.group(1), "grp": head.group(2), "ad": JsLit(head.group(3)).value()}
        for key in ("layer", "badge", "extra"):
            m = re.search(r'\b' + key + r': "([^"]*)"', blk)
            d[key] = m.group(1) if m else ""
        m = re.search(r'\bkime: ("(?:[^"\\]|\\.)*")', blk)
        d["kime"] = JsLit(m.group(1)).value() if m else None   # işlev ise null
        d["toggle"] = bool(re.search(r"\btoggle: true", blk))
        for key in ("tip", "rw", "what", "effect"):
            m = re.search(r'\b' + key + r': ("(?:[^"\\]|\\.)*")', blk)
            d[key] = JsLit(m.group(1)).value() if m else ""
        alanlar = []
        for m in re.finditer(r"(?<![\w.])(f|ch|tg)\(", blk):
            p = JsLit(blk, m.end())
            a = p.args()
            if m.group(1) == "f":
                alanlar.append({"tur": "aralik", "k": a[0], "min": a[1], "max": a[2], "adim": a[3],
                                "sembol": a[4] if len(a) > 4 else "", "birim": a[5] if len(a) > 5 else ""})
            elif m.group(1) == "ch":
                alanlar.append({"tur": "secim", "k": a[0], "secenekler": a[1]})
            else:
                alanlar.append({"tur": "anahtar", "k": a[0], "etiket": a[1]})
        d["alanlar"] = alanlar
        d["satirlar"] = re.findall(r'\{ l: "([^"]+)", p:', blk)
        out.append(d)
    return out


def templates(text: str):
    body = method_body(text, "templates")
    out = []
    for m in re.finditer(r'\{ id: (\d+), name: ("(?:[^"\\]|\\.)*"), desc: ("(?:[^"\\]|\\.)*"), badge: ("(?:[^"\\]|\\.)*"), series: ("(?:[^"\\]|\\.)*"), set: (.*?) \},?\n', body):
        ham = m.group(6)
        out.append({"id": int(m.group(1)), "ad": JsLit(m.group(2)).value(), "aciklama": JsLit(m.group(3)).value(),
                    "olcum_rozeti": JsLit(m.group(4)).value(), "seri": JsLit(m.group(5)).value(),
                    "set_ham": ham,
                    "set_anahtarlari": re.findall(r'"([^"]+)":', ham) + re.findall(r"(__\w+):", ham),
                    "taban_B": ham.startswith("B") or ham.startswith("ext(")})
    return out


def multi_defs(text: str):
    body = method_body(text, "multiDefs")
    out = {}
    for m in re.finditer(r'^      "([^"]+)": \[(.*)\],?$', body, re.M):
        out[m.group(1)] = re.findall(r'(?:R|DU|T|I|L)\("(\w+)"', m.group(2))
    return out


def seeds(text: str):
    body = method_body(text, "seeds")
    return JsLit(body, body.index("[")).value()


# ---------------------------------------------------------------- denetim tabloları
_SINIF = re.compile(r"[PVSY]")


_AD = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def model_adlari(ham: str):
    """Denetimin 'Model' sütunundaki TÜM backtick adları. `A_B/C/D_E` kısaltması açılır (ilk adın son parçası
    değişir: `YOUNG_WEEKS/GRACE/RATE_MULT` -> YOUNG_WEEKS, YOUNG_GRACE, YOUNG_RATE_MULT; `RM_LO/RM_HI` tam ad).
    `FF_*`, `*_ON` gibi kalıplar ayrı döner (model varsayılanlarıyla genişletilir)."""
    adlar: set[str] = set()
    kaliplar: set[str] = set()
    for span in re.findall(r"`([^`]*)`", ham or ""):
        for parca in re.split(r"[,;]", span):
            parca = parca.strip()
            if not parca:
                continue
            ilk, *devam = [x.strip() for x in parca.split("/")]
            if _AD.match(ilk.replace("*", "X")):
                (kaliplar if "*" in ilk else adlar).add(ilk)
            son_atla = ilk.rsplit("_", 1)[0] + "_" if "_" in ilk else ""
            ilk_parca = ilk.split("_", 1)[0] + "_"
            for x in devam:
                if not x:
                    continue
                if "*" in x:
                    kaliplar.add(x)
                elif "_" in x and x.split("_", 1)[0] == ilk.split("_", 1)[0]:
                    adlar.add(x)                      # tam ad (RM_HI)
                else:
                    adlar.add((ilk_parca if "_" in x else son_atla) + x)
    return sorted(a for a in adlar if _AD.match(a)), sorted(kaliplar)


def denetim_satirlari(path: Path = DENETIM):
    """§1.1–§1.15 tablolarından 97 satır: no, ad, grup (bölüm başlığı), sinif (ilk harf), model adları."""
    txt = path.read_text(encoding="utf-8")
    sec = re.search(r"^## 1\. .*?$", txt, re.M)
    end = re.search(r"^### 1\.16", txt, re.M)
    out, grup = [], ""
    for line in txt[sec.end():end.start()].splitlines():
        h = re.match(r"^### 1\.\d+ (.+?)(?: \(.*)?(?::.*)?$", line)
        if h:
            grup = h.group(1).strip()
            continue
        m = re.match(r"^\| (\d+) \| (.+?) \| (.+?) \| (.+?) \|", line)
        if not m:
            continue
        sinif_ham = re.sub(r"\*", "", m.group(4)).strip()
        first = _SINIF.search(sinif_ham)
        modeller, kaliplar = model_adlari(m.group(3))
        out.append({"no": int(m.group(1)), "proto": m.group(2).strip(), "grup": grup, "sinif": first.group(0),
                    "sinif_ham": sinif_ham, "model_ham": m.group(3).strip(), "model_adlari": modeller, "model_kaliplari": kaliplar})
    return out


# ---------------------------------------------------------------- bütün taslak
def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def readme_sha() -> str | None:
    m = re.search(r"sha256: `([0-9a-f]{64})`", REF_README.read_text(encoding="utf-8"))
    return m.group(1) if m else None


def cikar(prototip: Path = PROTOTIP) -> dict:
    text = prototip.read_text(encoding="utf-8")
    bhv = bhv_defs(text)
    return {
        "meta": {"prototip": str(prototip), "sha256": sha256(prototip), "bayt": prototip.stat().st_size},
        "katalog": catalog_current(text),
        "katalog_gruplari": group_names_current(text),
        "katalog_eski": catalog_old(text),
        "denetim": denetim_satirlari(),
        "davranis": bhv,
        "piyasa": market_items(text),
        "kredi_ortak": cr_common(text),
        "kredi_turleri": cr_types(text),
        "sablonlar": templates(text),
        "senaryolar": scenarios(text),
        "gercek_dunya": real_world(text),
        "takma_adlar": rule_aliases(text),
        "profiller": profiles(text),
        "coklu_alanlar": multi_defs(text),
        "tohumlar": seeds(text),
    }


def sayimlar(d: dict) -> dict:
    b = d["davranis"]
    return {
        "katalog": len(d["katalog"]),
        "katalog_eski": len(d["katalog_eski"]),
        "denetim": len(d["denetim"]),
        "denetim_sinif": {k: sum(1 for r in d["denetim"] if r["sinif"] == k) for k in "PVSY"},
        "hane": len(next(a for a in b["actors"] if a["id"] == "hane")["rows"]),
        "girisimci": len(next(a for a in b["actors"] if a["id"] == "giri")["rows"]),
        "davranis_toplam": sum(len(a["rows"]) for a in b["actors"]) + len(b["world"]) + len(b["consts"]) + len(b["calib"]),
        "piyasa": len(d["piyasa"]),
        "kredi_turu": len(d["kredi_turleri"]),
        "kredi_ortak": len(d["kredi_ortak"]),
        "sablon": len(d["sablonlar"]),
        "senaryo": len(d["senaryolar"]),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true", help="taslağı JSON olarak stdout'a yaz")
    ap.add_argument("--ozet", action="store_true", help="yalnız sayımları yaz")
    ap.add_argument("--prototip", type=Path, default=PROTOTIP)
    a = ap.parse_args(argv)
    d = cikar(a.prototip)
    if a.json:
        json.dump(d, sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
    else:
        json.dump(sayimlar(d), sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
