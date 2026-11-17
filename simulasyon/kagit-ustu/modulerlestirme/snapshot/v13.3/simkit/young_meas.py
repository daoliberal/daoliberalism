"""simkit.young_meas: K-215/K-216 ölçüm satırları (WEEKLY_CSV yk_* sütunları), sonuç sözlüğü R["yk"] ve rapor bölümü (yalnız YOUNG_KIT/FOUND_FUND açıkken çağrılır).

ARAYÜZ: yk_week_row(W), yk_results(W), yk_report_text(R, weeks)
OKUR: W.firms, W.player_firms, W.loans, W.L, W.cities, W.yk. YAZAR: yok.
KATMAN: L1 (yalnız params ve young_core).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.young_core import is_fund_lo, yk_state, yk_young


def yk_week_row(W):
    S = yk_state(W)
    st = S["stat"]
    firms = W.firms
    yg = [f for f in W.player_firms if not firms[f].get("dead") and yk_young(W, firms[f]) and firms[f]["workers"]]
    fb = sum(W.L.bal[f"KFON{c['i']}_sermaye"] for c in W.cities) if FOUND_FUND else 0.0
    fo = sum(ln["out"] for ln in W.loans.values() if is_fund_lo(ln["lo"]))
    return dict(yk_fon_bakiye=round(fb), yk_fon_borc=round(fo), yk_fon_verilen_kum=round(st["fon_verilen"]), yk_fon_iade_kum=round(st["fon_iade"]),
                yk_genc_n=len(yg), yk_genc_kadro_ort=round(sum(len(firms[f]["workers"]) for f in yg) / max(1, len(yg)), 2),
                yk_ise_alim_kum=int(st["ise_alim"]), yk_kucul_kum=int(st["kucul_genc_kisi"]), yk_salinim_kum=int(st["salinim"]), yk_cekim_kum=int(st["cekim_adet"]), yk_limit_siki_kum=int(st["limit_siki"]))


def yk_results(W):
    S = yk_state(W)
    return dict(stat=dict(S["stat"]), grp=dict(S["grp"]), fund_hist=list(S["fund_hist"]))


def yk_report_text(R, weeks):
    t = R["yk"]
    st, fh = t["stat"], t["fund_hist"]
    o = ["\n## Kuruluş fonu ve genç firma kiti (K-215/K-216)\n",
         f"Bayraklar: `FOUND_FUND`={FOUND_FUND}, `YOUNG_KIT`={YOUNG_KIT}. Fon hedefi: şehir kasası + fon + fon alacağının %{FF_SHARE * 100:.0f}'i (haftalık aktarım tavanı %{FF_WEEKLY * 100:.0f}, kasa tabanı {FF_FLOOR_WEEKS:g} hf zorunlu gider); para yalnız şehir kasasından (basımsız).\n",
         f"Fon izi: şehirlerden fona aktarılan {st.get('fon_fonlanan', 0):,.0f} Akçe; firmalara verilen (kuruluş + çekim + yuva + reklam) {st.get('fon_verilen', 0):,.0f}; geri dönen (anapara) {st.get('fon_iade', 0):,.0f} + diğer geri ödeme/faiz kayıtları ledger `kurulus_fonu_*`. "
         f"Çekim {st.get('cekim_adet', 0):.0f} adet / {st.get('cekim_akce', 0):,.0f} Akçe; limitin bağlayıcı olduğu çekim isteği {st.get('limit_siki', 0):.0f}; fon yetersizliği/karışık kayıt reddi {st.get('fon_red_kayit', 0):.0f}.",
         "", "| hafta | fon bakiyesi | fon alacağı | kümülatif verilen | kümülatif geri/faiz | kümülatif fonlanan |", "|---|---|---|---|---|---|"]
    for row in fh:
        if row[0] in (10, 20, 35, 50, 75, 100, 150, 200, 300, 400, 500) or row[0] == weeks:
            o.append(f"| {row[0]} | {row[1]:,.0f} | {row[2]:,.0f} | {row[3]:,.0f} | {row[4]:,.0f} | {row[5]:,.0f} |")
    o += ["", f"Talebe bağlı işe alım: {st.get('ise_alim', 0):.0f} kişi ({st.get('ise_alim_hafta_firma', 0):.0f} firma-haftası); nakit/limit yüzünden reddedilen {st.get('ise_alim_nakit_red', 0):.0f}, aday bulunamayan {st.get('ise_alim_aday_yok', 0):.0f}. "
          f"SHRINK_FIRST ile genç firmadan çıkarılan {st.get('kucul_genc_kisi', 0):.0f} kişi; bunun {YK_OSC_WEEKS} hf içinde işe alınmış olanı (alım/çıkarma salınımı) {st.get('salinim', 0):.0f}. "
          f"Açılış reklamı {st.get('acilis_reklam_adet', 0):.0f} firma / {st.get('acilis_reklam_akce', 0):,.0f} Akçe. Ortaklı kuruluş {st.get('ortakli_kurulus', 0):.0f} ({st.get('ortak_kisi', 0):.0f} ortak, ortak sermaye {st.get('ortak_sermaye', 0):,.0f}); ortak bulunamayıp atlanan {st.get('ortak_yok', 0):.0f}. "
          f"Ölçek grubu dağılımı (kurulan firma): {t['grp']}."]
    return o
