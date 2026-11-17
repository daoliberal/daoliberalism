"""simkit.wages: ücret işlevleri (res_wage, role_wage, role_ok).

ARAYÜZ: res_wage, kadro_ucreti, role_ok, role_wage
OKUR: W.WI, W.MWI, W.RWI, W.REP, W.people, W.skillw. YAZAR: yok.
KATMAN: L0.
"""
from simkit.params import *          # noqa: F401,F403


def res_wage(W, ci):
    RWI = W.RWI
    WI = W.WI
    return round(RES_WAGE_MULT * TIER_WAGE[2] * WI[ci] * RWI[ci], 3)


def kadro_ucreti(W, tier, kind, ci, npc):
    """sıradan (araştırmacı ve yönetici olmayan) kişinin DÖNGÜ ücreti (haftalık = × CYCLES_PER_WEEK): tier, firmanın şehrinin WI'ı ve firma türünün çarpanları (kind None: işsiz, yalnız tier ve WI).
    ahır ve belediyede SKILL_ON iken taban tier; ahırda WELF_AHIR_MULT; hizmet türlerinde KIND_WM; belediyede NPC için JG_WAGE (MUNI_POOL=1).
    phase_wages (bot ve insan ücreti) ve human.ilan_ucreti (iş ilanı) bu tek işlevi çağırır: ilan ücreti ile alınan ücret ayrışamaz."""
    pub = kind in ("ahir", "belediye")
    return round(TIER_WAGE[0 if (pub and SKILL_ON) else tier] * W.WI[ci] * (WELF_AHIR_MULT if (W.WELF_ON and kind == "ahir") else 1.0) * (KIND_WM.get(kind, 1.0) if (SVC_KINDS and kind is not None) else 1.0) * (JG_WAGE if (MUNI_POOL == 1 and pub and npc and kind == "belediye") else 1.0), 3)


def role_ok(W, q, kind):
    REP = W.REP
    people = W.people
    skillw = W.skillw
    i = people[q]
    wk = skillw[q] / CYCLES_PER_WEEK
    if kind == "yonetici":
        return wk >= MGR_WEEKS and REP[q] >= MGR_REP
    inv = i.get("innov")
    return wk >= (SPEC_WEEKS_INNOV if inv else SPEC_WEEKS) and REP[q] >= (SPEC_REP_INNOV if inv else SPEC_REP)


def role_wage(W, kind, ci):
    MWI = W.MWI
    WI = W.WI
    return round(TIER_WAGE[2] * (MGR_MULT if kind == "yonetici" else SPEC_MULT) * WI[ci] * MWI[0], 3)
