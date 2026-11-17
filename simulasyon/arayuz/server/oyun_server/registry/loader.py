"""Kayıt yükleyici: settings.*.json + metinler/groups/templates/seeds -> Registry."""
from __future__ import annotations

import copy
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .. import config
from . import codec as codec_mod
from .schema import ACTORS, NEW_MEASUREMENT_DECISIONS, UNITS, RegistryError, SettingDef, codec_params, parse_setting

DEFAULT_DATA_DIR = config.REPO_ROOT / "simulasyon" / "arayuz" / "registry"


def _read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
    except OSError as e:
        raise RegistryError(f"{path.name}: okunamadı ({e})") from e
    except ValueError as e:
        raise RegistryError(f"{path.name}: geçersiz JSON ({e})") from e


@dataclass
class Registry:
    settings: list[SettingDef]
    hidden: list[SettingDef]
    templates: dict[str, dict]
    seeds: list[float]
    groups: list[dict]
    texts: dict
    defaults: dict
    by_id: dict[str, SettingDef] = field(default_factory=dict)
    dayanaklar: dict = field(default_factory=dict)
    scenarios: list[dict] = field(default_factory=list)
    consistency: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.by_id = {s.id: s for s in self.settings}

    @property
    def value_words(self) -> dict:
        """Biçimlendirme sözcükleri: `_degerler` (açık/kapalı/yok…) + `_birimler` (birim şablonları `{n}`)."""
        return {**self.texts["_degerler"], **self.texts.get("_birimler", {})}

    def decode(self, s: SettingDef, raw: Any) -> Any:
        return codec_mod.decode(s.codec, raw, self.seeds)

    # ---- varsayılanlar ve ölçüm değerleri ------------------------------------------------------------------
    def model_value(self, s: SettingDef) -> Any:
        """Kartın model varsayılanı: skaler / fields için {param: değer} / order-multi için liste."""
        if s.codec["type"] == "fields":
            return {p: self.defaults[p] for p in codec_params(s.codec)}
        return self.defaults[s.params[0]]

    def default_ui(self, s: SettingDef) -> Any:
        """Kartın varsayılan arayüz değeri: `params` varsa model varsayılanından, yoksa kartın `default`ından."""
        if s.params:
            return codec_mod.encode(s.codec, self.model_value(s), self.seeds)
        return s.default if s.default is not None else codec_mod.neutral_ui(s.codec)

    def measured_values(self, s: SettingDef) -> list:
        """`measured_at` biçimi -> arayüz değerleri listesi.

        Tek değerli kartlarda (seçenek, sayı, aç/kapa, fields) değer ya da değer listesi. Liste değerli kartlarda
        (order, multi) düz dizge listesi TEK değerdir; birden çok değer liste listesi olarak yazılır.
        """
        m = s.measured_at
        if m is None:
            return []
        if s.codec["type"] in ("order", "multi"):
            return list(m) if isinstance(m, list) and m and all(isinstance(x, list) for x in m) else [m]
        return list(m) if isinstance(m, list) else [m]

    # ---- kamusal çıktı -------------------------------------------------------------------------------------
    def _labels(self, section: dict, keys) -> list[dict]:
        return [{"value": k, "label": section[k]} for k in keys]

    def _control(self, c: dict, t: dict) -> dict:
        ty = c["type"]
        if ty == "enum":
            return {"type": "options", "options": self._labels(t["options"], c["map"])}
        if ty == "bool":
            w = self.texts["_degerler"]
            return {"type": "options", "options": [{"value": True, "label": w["acik"]}, {"value": False, "label": w["kapali"]}]}
        if ty == "seed":
            return {"type": "options", "options": [{"value": i, "label": t["options"][str(i)]} for i in range(len(self.seeds))]}
        if ty == "number":
            return codec_mod.number_control(c)
        if ty == "fields":
            out = []
            for f in c["fields"]:
                ft = t["fields"][f["key"]]
                item = {"key": f["key"], "label": ft["label"]}
                if "hint" in ft:
                    item["hint"] = ft["hint"]
                item["control"] = self._control(f["codec"], ft)
                out.append(item)
            return {"type": "fields", "fields": out}
        return {"type": ty, "items": self._labels(t["items"], c["items"])}

    def _card_public(self, s: SettingDef) -> dict:
        t = self.texts[s.id]
        d = s.structure()
        del d["codec"], d["measured_at"]
        d["measured_values"] = self.measured_values(s) or None
        d["new_measurement"] = s.decision in NEW_MEASUREMENT_DECISIONS      # son inceleme I1: bu kart varsayılandan farklıysa koşu "yeni ölçüm"dür
        d["params"], d["requires"] = list(s.params), list(s.requires)
        for k in ("title", "what", "changes", "hint", "basis", "warning", "aliases"):
            if k in t:
                d[k] = t[k]
        d["control"] = self._control(s.codec, t)
        d["default"] = self.default_ui(s)
        if s.shows:
            d["shows"] = self._shows_public(s)
        return d

    def _shows_public(self, s: SettingDef) -> list[dict]:
        """Salt okunur satırlar: `{label?, value, text}` (parametre adı yayımlanmaz; etiket yoksa yalnız metin)."""
        labels = self.texts[s.id].get("shows", {})
        out = []
        for e in s.shows:
            value, text = codec_mod.show_value(e, self.defaults[e["key"]], self.value_words)
            row = {}
            label = labels.get(e.get("label_key", e["key"]))
            if label is not None:
                row["label"] = label
            row.update(value=value, text=text)
            out.append(row)
        return out

    def behavior_changes(self, t: dict) -> list[str]:
        """Şablonun model varsayılanından farklı yazdığı dünya varsayımı kartları (kimlik sırasıyla)."""
        out = []
        for wid, wval in t["world_values"].items():
            c = self.by_id[wid]
            if codec_mod.decode(c.codec, wval, self.seeds) == codec_mod.decode(c.codec, self.default_ui(c), self.seeds):
                continue
            if not all(self._template_value(t, k) == v for k, v in c.effective_when.items()):
                continue                    # başka kartın koşuluna bağlı varsayım koşul kapalıyken etkisiz: değişen sayılmaz
            out.append(wid)
        return sorted(out)

    def _template_value(self, t: dict, card_id: str) -> Any:
        """Şablon uygulanınca kartın arayüz değeri (şablon değeri, yoksa varsayılan)."""
        return t["values"][card_id] if card_id in t["values"] else self.default_ui(self.by_id[card_id])

    def startability(self, t: dict) -> dict:
        """`startable`: şablonla koşu bugünkü kurallarla başlatılabilir mi; `blocked_by`: engelleyen kartlar
        (`apply:"unknown"` ya da pasif kart değeri içerenler başlatılamaz: DK-17)."""
        blocked = sorted(k for k in (*t["values"], *t["world_values"])
                         if self.by_id[k].apply == "unknown" or self.by_id[k].status == "passive")
        return {"startable": not blocked, "blocked_by": blocked}

    def scenario_startability(self, sc: dict) -> dict:
        """Dünya senaryosu bugünkü kurallarla başlatılabilir mi: `apply:"unknown"` kart değeri içeren senaryo başlatılamaz (DK-17)."""
        blocked = sorted(k for k in sc["values"] if self.by_id[k].apply == "unknown")
        return {"startable": not blocked, "blocked_by": blocked}

    def public_seeds(self) -> list[dict]:
        return [{"index": i, "label": v} for i, v in enumerate(self.seeds)]

    def public(self) -> dict:
        """İstemciye giden kayıt: `{cards, groups, templates, scenarios}` (yapı + metin; `decision` ve `codec` yok)."""
        gt, tt, st = self.texts.get("_gruplar", {}), self.texts.get("_sablonlar", {}), self.texts.get("_senaryolar", {})
        return {
            "units": self.value_words,
            "cards": [self._card_public(s) for s in self.settings],
            "groups": [{**g, **gt.get(g["id"], {})} for g in self.groups],
            "templates": [{"id": i, **tt.get(i, {}), "values": dict(t["values"]), "world_values": dict(t["world_values"]),
                           "behavior_changes": self.behavior_changes(t), **self.startability(t)} for i, t in self.templates.items()],
            "scenarios": [{"id": sc["id"], **st.get(sc["id"], {}), "values": dict(sc["values"]), **self.scenario_startability(sc)}
                          for sc in self.scenarios],
            "consistency": copy.deepcopy(self.consistency),
        }

    def fixed_rules(self) -> list[dict]:
        """Kilitli bağlam kartları: `valueText` model varsayılanından ve codec biçiminden gelir (P-03)."""
        out = []
        for s in self.settings:
            if s.layer != "P" or s.editable or not s.params or any(p not in self.defaults for p in s.params):
                continue
            text = codec_mod.format_value(s.codec, self.model_value(s), self.value_words, self._format_labels(s), self.seeds)
            out.append({"settingId": s.id, "valueKey": f"lock.deger.{s.id}", "valueText": text})
        return out

    def _format_labels(self, s: SettingDef) -> dict:
        t = self.texts[s.id]
        c = s.codec["type"]
        if c in ("enum", "seed"):
            return dict(t.get("options", {}))
        if c in ("order", "multi"):
            return dict(t.get("items", {}))
        if c == "fields":
            return {k: v["label"] for k, v in t.get("fields", {}).items()}
        return {}


def load_text_rules(data_dir: Path) -> list[dict]:
    return _read(Path(data_dir) / "metin_kurallari.json")["forbidden"]


def load_dayanaklar(data_dir: Path) -> dict:
    """`dayanaklar.json`: izinli dayanak etiketleri (DK-4). Her model girdisinin depo içi kaynağı vardır."""
    raw = _read(Path(data_dir) / "dayanaklar.json")
    og, ml = (raw.get("oyuna_ozgu"), raw.get("modeller")) if isinstance(raw, dict) else (None, None)
    if not isinstance(og, str) or not og.strip() or not isinstance(ml, list):
        raise RegistryError("dayanaklar.json: 'oyuna_ozgu' ve 'modeller' gerekli")
    labels = {og}
    for m in ml:
        if (not isinstance(m, dict) or not isinstance(m.get("label"), str) or not m["label"].strip()
                or not isinstance(m.get("kaynak"), str) or not m["kaynak"].strip()):
            raise RegistryError("dayanaklar.json: model girdisi {label, kaynak} olmalı")
        labels.add(m["label"])
    return {"labels": labels, "oyuna_ozgu": og, "modeller": ml}


def _text(t: dict, k: str, where: str, required: bool = True) -> None:
    v = t.get(k)
    if v is None and not required:
        return
    if not isinstance(v, str) or not v.strip():
        raise RegistryError(f"{where}: '{k}' metni eksik/geçersiz")


def _check_texts(where: str, c: dict, t: Any, n_seeds: int) -> None:
    """Codec türüne göre gerekli etiketler (seçenek, alan, öğe)."""
    if not isinstance(t, dict):
        raise RegistryError(f"{where}: metin nesne olmalı")
    ty = c["type"]
    if ty == "enum":
        opts = t.get("options")
        if not isinstance(opts, dict) or any(not isinstance(opts.get(k), str) or not opts[k].strip() for k in c["map"]):
            raise RegistryError(f"{where}: seçenek metinleri eksik")
    elif ty == "seed":
        opts = t.get("options")
        if not isinstance(opts, dict) or any(not isinstance(opts.get(str(i)), str) or not opts[str(i)].strip()
                                             for i in range(n_seeds)):
            raise RegistryError(f"{where}: başlangıç dünyası seçenek metinleri eksik")
    elif ty in ("order", "multi"):
        items = t.get("items")
        if not isinstance(items, dict) or any(not isinstance(items.get(k), str) or not items[k].strip() for k in c["items"]):
            raise RegistryError(f"{where}: öğe etiketleri eksik")
    elif ty == "fields":
        ft = t.get("fields")
        if not isinstance(ft, dict):
            raise RegistryError(f"{where}: alan etiketleri eksik")
        for f in c["fields"]:
            e = ft.get(f["key"])
            if not isinstance(e, dict):
                raise RegistryError(f"{where}: alan '{f['key']}' etiketi eksik")
            _text(e, "label", f"{where}.{f['key']}")
            _text(e, "hint", f"{where}.{f['key']}", required=False)
            _check_texts(f"{where}.{f['key']}", f["codec"], e, n_seeds)


def _check_shows_texts(s: SettingDef, t: dict) -> None:
    sh = t.get("shows")
    if sh is None:
        return
    if not isinstance(sh, dict) or not sh:
        raise RegistryError(f"{s.id}: shows etiketleri nesne olmalı")
    known = {e.get("label_key", e["key"]) for e in s.shows}
    for k, v in sh.items():
        if k not in known:
            raise RegistryError(f"{s.id}: shows etiketi '{k}' için satır yok")
        if not isinstance(v, str) or not v.strip():
            raise RegistryError(f"{s.id}: shows etiketi '{k}' dizge olmalı")


def _enum_values_not_strings(sid: str, c: dict) -> None:
    if c["type"] == "enum" and any(isinstance(v, str) for v in c["map"].values()):
        raise RegistryError(f"{sid}: enum haritası dizge model değeri içeremez")
    for f in c.get("fields", []) if c["type"] == "fields" else []:
        _enum_values_not_strings(f"{sid}.{f['key']}", f["codec"])


def is_world_card(c: SettingDef) -> bool:
    """Şablonun `world_values` yazabileceği kart: yalnız senaryoyla düzenlenebilen V kartı (Y, P ve salt okunur kartlar yazılamaz)."""
    return c.layer == "V" and c.scenario_editable


def load_registry(data_dir: Path, defaults: dict) -> Registry:
    from . import resolve   # döngüsel içe aktarmayı önler

    data_dir = Path(data_dir)
    groups_raw = _read(data_dir / "groups.json")
    groups = groups_raw.get("groups") if isinstance(groups_raw, dict) else None
    if not isinstance(groups, list) or not all(isinstance(g, dict) and g.get("id") for g in groups):
        raise RegistryError("groups.json: 'groups' listesi geçersiz")
    group_ids = {g["id"] for g in groups}

    texts = _read(data_dir / "metinler.tr.json")
    if not isinstance(texts, dict):
        raise RegistryError("metinler.tr.json: nesne olmalı")
    for k, need in (("_degerler", ("acik", "kapali", "yok")), ("_birimler", UNITS)):
        sec = texts.get(k)
        if not isinstance(sec, dict):
            raise RegistryError(f"metinler.tr.json: '{k}' eksik")
        for w in need:
            if not isinstance(sec.get(w), str) or not sec[w].strip():
                raise RegistryError(f"metinler.tr.json: {k}.{w} eksik")
    for u in UNITS:
        if "{n}" not in texts["_birimler"][u]:
            raise RegistryError(f"metinler.tr.json: _birimler.{u} '{{n}}' içermeli")

    dayanaklar = load_dayanaklar(data_dir)

    seeds_raw = _read(data_dir / "seeds.json")
    pm = seeds_raw.get("pm_adj") if isinstance(seeds_raw, dict) else None
    if (not isinstance(pm, list) or not pm
            or not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in pm)):
        raise RegistryError("seeds.json: pm_adj geçersiz")
    seeds = [float(x) for x in pm]

    cards: list[SettingDef] = []
    seen: set[str] = set()
    files = sorted(data_dir.glob("settings.*.json"))
    if not files:
        raise RegistryError("settings.*.json bulunamadı")
    for f in files:
        data = _read(f)
        lst = data.get("settings") if isinstance(data, dict) else None
        if not isinstance(lst, list):
            raise RegistryError(f"{f.name}: 'settings' listesi yok")
        for raw in lst:
            s = parse_setting(raw, f.name)
            if s.id in seen:
                raise RegistryError(f"{s.id}: yinelenen kimlik ({f.name})")
            seen.add(s.id)
            if s.group not in group_ids:
                raise RegistryError(f"{s.id}: bilinmeyen grup '{s.group}'")
            cards.append(s)

    owner: dict[str, str] = {}
    for s in cards:
        for p in s.params:
            if p in owner and owner[p] != s.id:
                raise RegistryError(f"{s.id}: parametre '{p}' zaten '{owner[p]}' kartında")
            owner[p] = s.id

    def need_title(section: str, ident: str) -> None:
        t = (texts.get(section) or {}).get(ident)
        if not isinstance(t, dict) or not isinstance(t.get("title"), str) or not t["title"].strip():
            raise RegistryError(f"metinler.tr.json: {section}.{ident} başlığı eksik")

    for g in groups:
        need_title("_gruplar", g["id"])
    for a in ACTORS:                                    # Dünyanın insanları bölümleri (aktör başlığı ve girişi)
        t_ = (texts.get("_aktorler") or {}).get(a)
        if not isinstance(t_, dict) or not all(isinstance(t_.get(k), str) and t_[k].strip() for k in ("title", "intro")):
            raise RegistryError(f"metinler.tr.json: _aktorler.{a} başlık/giriş eksik")

    for s in cards:
        t = texts.get(s.id)
        if not isinstance(t, dict) or not all(isinstance(t.get(k), str) and t[k].strip() for k in ("title", "what", "changes")):
            raise RegistryError(f"{s.id}: metinler.tr.json'da metin eksik (title/what/changes)")
        _check_texts(s.id, s.codec, t, len(seeds))
        _text(t, "hint", s.id, required=False)
        _text(t, "warning", s.id, required=False)
        al = t.get("aliases")
        if al is not None and (not isinstance(al, list) or not al or not all(isinstance(x, str) and x.strip() for x in al)):
            raise RegistryError(f"{s.id}: aliases dizge listesi olmalı")
        b = t.get("basis")
        if b is not None:
            if not isinstance(b, dict) or not isinstance(b.get("label"), str):
                raise RegistryError(f"{s.id}: basis.label eksik")
            if b["label"] not in dayanaklar["labels"]:
                raise RegistryError(f"{s.id}: basis.label dayanaklar.json'da yok ({b['label']!r})")
            _text(b, "note", f"{s.id}.basis", required=False)
        _enum_values_not_strings(s.id, s.codec)

    settings, hidden = [], []
    for s in cards:
        (hidden if any(r not in defaults for r in s.requires) else settings).append(s)
    for s in settings:
        for p in s.params:
            if p not in defaults:
                raise RegistryError(f"{s.id}: parametre '{p}' modelde yok (requires'a ekle)")
            if isinstance(defaults[p], str):
                raise RegistryError(f"{s.id}: parametre '{p}' dizge değerli; kart desteklemez")
        for e in s.shows:
            p = e["key"]
            if p not in defaults:
                raise RegistryError(f"{s.id}: shows '{p}' modelde yok")
            try:
                codec_mod.show_value(e, defaults[p], {**texts["_degerler"], **texts["_birimler"]})
            except (ValueError, KeyError) as ex:
                raise RegistryError(f"{s.id}: shows '{p}' gösterilemez ({ex}); yalnız sayı ve bool") from ex
    for s in cards:
        _check_shows_texts(s, texts[s.id])

    tpl_raw = _read(data_dir / "templates.json")
    tl = tpl_raw.get("templates") if isinstance(tpl_raw, dict) else None
    if not isinstance(tl, list):
        raise RegistryError("templates.json: 'templates' listesi yok")

    scen: list[dict] = []
    sp = data_dir / "senaryolar.json"
    if sp.is_file():
        sraw = _read(sp)
        sl = sraw.get("scenarios") if isinstance(sraw, dict) else None
        if not isinstance(sl, list) or not all(isinstance(x, dict) and x.get("id") and isinstance(x.get("values"), dict) for x in sl):
            raise RegistryError("senaryolar.json: 'scenarios' listesi geçersiz")
        for x in sl:
            need_title("_senaryolar", x["id"])
        scen = [{"id": x["id"], "values": x["values"]} for x in sl]
        if len({x["id"] for x in scen}) != len(scen):
            raise RegistryError("senaryolar.json: yinelenen senaryo kimliği")

    reg = Registry(settings=settings, hidden=hidden, templates={}, seeds=seeds, groups=groups, texts=texts,
                   defaults=defaults, dayanaklar=dayanaklar, scenarios=scen)

    # varsayılanlar arayüz değerine çevrilebilmeli ve codec'ten (aralık, adım, öğe kümesi) geçmeli
    for s in settings:
        try:
            ui = reg.default_ui(s)
            codec_mod.decode(s.codec, ui, seeds)
        except (ValueError, TypeError, KeyError) as e:
            raise RegistryError(f"{s.id}: model varsayılanı codec'e uymuyor ({e})") from e
    for s in hidden:
        if not s.params and s.default is not None:
            try:
                codec_mod.decode(s.codec, s.default, seeds)
            except (ValueError, TypeError) as e:
                raise RegistryError(f"{s.id}: default codec'e uymuyor ({e})") from e

    hidden_ids = {s.id for s in hidden}
    for t in tl:
        if not isinstance(t, dict) or not t.get("id") or not isinstance(t.get("values"), dict):
            raise RegistryError("templates.json: şablon geçersiz")
        vals = {k: v for k, v in t["values"].items() if k not in hidden_ids}
        r = resolve.resolve(reg, vals)
        if r.errors:
            raise RegistryError(f"şablon {t['id']}: değer geçersiz ({r.errors[0].id}: {r.errors[0].reason})")
        need_title("_sablonlar", t["id"])
        wv = t.get("world_values", {})
        if not isinstance(wv, dict):
            raise RegistryError(f"şablon {t['id']}: world_values nesne olmalı")
        for wid, wval in wv.items():
            wc = reg.by_id.get(wid)
            if wc is None or not is_world_card(wc):
                raise RegistryError(f"şablon {t['id']}: world_values '{wid}' dünya varsayımı kartı değil (senaryo düzenlenebilir V kartı olmalı)")
            try:
                codec_mod.decode(wc.codec, wval, seeds)
            except (ValueError, TypeError) as e:
                raise RegistryError(f"şablon {t['id']}: world_values {wid} değeri geçersiz ({e})") from e
        reg.templates[t["id"]] = {"id": t["id"], "values": vals, "world_values": dict(wv)}

    _check_measured(reg, cards)
    _check_effective_when(reg, cards)
    _check_scenarios(reg)
    reg.consistency = _load_consistency(data_dir, reg, texts)
    return reg


def _check_rule_value(rid: str, card: SettingDef | None, val: Any) -> None:
    """`when` değeri kartın codec'inden geçmeli (fields kartında yalnız verilen alanlar sınanır); gizli kart sınanmaz."""
    if card is None:
        return
    try:
        if isinstance(val, dict):
            if card.codec["type"] != "fields":
                raise ValueError("alan değeri yalnız fields kartında")
            fl = {f["key"]: f["codec"] for f in card.codec["fields"]}
            if not set(val) <= set(fl):
                raise ValueError("bilinmeyen alan")
            for k, v in val.items():
                codec_mod.decode(fl[k], v)
        else:
            codec_mod.decode(card.codec, val)
    except (ValueError, TypeError) as e:
        raise RegistryError(f"tutarlilik.json: {rid} değeri geçersiz ({card.id}: {e})") from e


def _load_consistency(data_dir: Path, reg: Registry, texts: dict) -> list[dict]:
    """`tutarlilik.json` -> `[{id, text, when | artan}]`; `text` `_uyarilar` bölümünden çözülür, kart kimlikleri kayıtta olmalı."""
    path = data_dir / "tutarlilik.json"
    if not path.is_file():
        return []
    raw = _read(path)
    rules = raw.get("rules") if isinstance(raw, dict) else None
    if not isinstance(rules, list):
        raise RegistryError("tutarlilik.json: 'rules' listesi yok")
    known = {*reg.by_id, *(h.id for h in reg.hidden)}       # modelde parametresi olmayan (gizli) kartın kuralı yayımlanmaz
    hidden = {h.id for h in reg.hidden}
    out, seen = [], set()
    for r in rules:
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not r["id"] or r["id"] in seen:
            raise RegistryError("tutarlilik.json: kural kimliği eksik ya da yinelenen")
        seen.add(r["id"])
        key = r.get("textKey")
        sec, _, name = key.partition(".") if isinstance(key, str) else ("", "", "")
        text = (texts.get(sec) or {}).get(name) if sec == "_uyarilar" else None
        if not isinstance(text, str) or not text.strip():
            raise RegistryError(f"tutarlilik.json: {r['id']} metni '{key}' bulunamadı")
        if ("when" in r) == ("artan" in r):
            raise RegistryError(f"tutarlilik.json: {r['id']} tam olarak biri olmalı: when ya da artan")
        item: dict = {"id": r["id"], "text": text}
        if "when" in r:
            if not isinstance(r["when"], dict) or not r["when"]:
                raise RegistryError(f"tutarlilik.json: {r['id']}.when boş/geçersiz")
            for card in r["when"]:
                if card not in known:
                    raise RegistryError(f"tutarlilik.json: {r['id']} bilinmeyen kart '{card}'")
            for card, val in r["when"].items():
                _check_rule_value(r["id"], reg.by_id.get(card), val)
            item["when"] = copy.deepcopy(r["when"])
        else:
            a = r["artan"]
            if not isinstance(a, dict) or a.get("kart") not in known or not isinstance(a.get("alanlar"), list):
                raise RegistryError(f"tutarlilik.json: {r['id']}.artan geçersiz ya da bilinmeyen kart")
            ac = reg.by_id.get(a["kart"])
            if ac is not None:
                keys = {f["key"] for f in ac.codec["fields"]} if ac.codec["type"] == "fields" else set()
                if not a["alanlar"] or not set(a["alanlar"]) <= keys:
                    raise RegistryError(f"tutarlilik.json: {r['id']}.artan alanları kartın alanlarında yok")
            item["artan"] = {"kart": a["kart"], "alanlar": list(a["alanlar"])}
        if isinstance(r.get("note"), str) and r["note"].strip():
            item["note"] = r["note"]
        used = set(r["when"]) if "when" in r else {r["artan"]["kart"]}
        if not used & hidden:
            out.append(item)
    return out


def _check_scenarios(reg: Registry) -> None:
    """Senaryo değerleri yalnız senaryoyla düzenlenebilen V kartlarına yazılır ve codec'ten geçer."""
    for sc in reg.scenarios:
        for cid, val in sc["values"].items():
            c = reg.by_id.get(cid)
            if c is None or not is_world_card(c):
                raise RegistryError(f"senaryo {sc['id']}: '{cid}' dünya varsayımı kartı değil (senaryo düzenlenebilir V kartı olmalı)")
            try:
                codec_mod.decode(c.codec, val, reg.seeds)
            except (ValueError, TypeError) as e:
                raise RegistryError(f"senaryo {sc['id']}: {cid} değeri geçersiz ({e})") from e


def _check_effective_when(reg: Registry, cards: list[SettingDef]) -> None:
    """`effective_when`: yalnız V kartında; koşul kartı bilinen P kartı, değeri codec'ten geçmeli."""
    for s in cards:
        if not s.effective_when:
            continue
        if s.layer != "V":
            raise RegistryError(f"{s.id}: effective_when yalnız V katmanında olabilir")
        for k, v in s.effective_when.items():
            other = reg.by_id.get(k)
            if other is None or other.layer != "P":
                raise RegistryError(f"{s.id}: effective_when bilinmeyen P kartı '{k}'")
            try:
                codec_mod.decode(other.codec, v, reg.seeds)
            except (ValueError, TypeError) as e:
                raise RegistryError(f"{s.id}: effective_when.{k} değeri geçersiz ({e})") from e


def _check_measured(reg: Registry, cards: list[SettingDef]) -> None:
    """DK-5: `measured_at` kartın codec'iyle çözülebilmeli; `measured_with` bilinen kart ya da şablon göstermeli."""
    known = reg.by_id            # yalnız yayımlanan (gizli olmayan) kartlar bağlam olabilir
    for s in cards:
        for v in reg.measured_values(s):
            try:
                codec_mod.decode(s.codec, v, reg.seeds)
            except (ValueError, TypeError) as e:
                raise RegistryError(f"{s.id}: measured_at değeri geçersiz ({e})") from e
        mw = s.measured_with
        if not mw:
            continue
        if "_sablon" in mw:
            if mw["_sablon"] not in reg.templates:
                raise RegistryError(f"{s.id}: measured_with bilinmeyen şablon '{mw['_sablon']}'")
            continue
        for k, v in mw.items():
            other = known.get(k)
            if other is None and k != s.id and any(h.id == k for h in reg.hidden):
                continue            # bağlam kartı modelde yok (requires eksik): kayıt yüklenir, hints.hint_applies bu ipucunu göstermez
            if other is None or k == s.id:
                raise RegistryError(f"{s.id}: measured_with bilinmeyen kart '{k}'")
            try:
                codec_mod.decode(other.codec, v, reg.seeds)
            except (ValueError, TypeError) as e:
                raise RegistryError(f"{s.id}: measured_with.{k} değeri geçersiz ({e})") from e
