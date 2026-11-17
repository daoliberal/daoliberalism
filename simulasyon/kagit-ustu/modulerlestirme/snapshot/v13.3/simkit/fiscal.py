"""simkit.fiscal: temettü stopajı (DIV_TAX) ve kâr payı dağıtımının TEK yeri (PK-6; yeni vergi/kesinti buraya eklenir).

AMAÇ: stopaj oranı ve ödeme sırası eskiden dört yerde elle tekrarlanıyordu (dao, labor, week_close, credit_service). Ödeme SIRASI ve ondalık
işlem sırası aynen korunur (vergi önce, sonra hissedarlar, sonra sahip): `(1 - DIV_TAX) * x * share` = `div_net(x) * share`.
ARAYÜZ:
  corp_tax_pay(L, frm, city_acct, x)  K-188 kurumlar vergisi: CORP_TAX > 0 ise CORP_TAX*x'i şehir kasasına öder ("kurumlar_vergisi"); vergi sonrası x'i döndürür
                                      (CORP_TAX = 0 iken hiçbir işlem yapmaz, x'i aynen döndürür: altınlar bayt bayt aynı). Zarar/fazla yoksa çağıran zaten çağırmaz.
  div_tax(x)                          stopaj tutarı = DIV_TAX * x
  div_net(x)                          vergi sonrası = (1 - DIV_TAX) * x
  pay_div_tax(L, frm, city_acct, x)   stopajı şehir kasasına öder ("temettu_vergisi"); ödenen tutar
  pay_holders(L, frm, holders, net)   hissedarlara pay oranında "kar_payi_dagitimi" öder (h["div"] birikir); sahibe KALAN net'i döndürür
  pay_owner_dividend(L, frm, city_acct, owner, x, holders=None)   tek çağrıda: stopaj, hissedarlar, sahip ("temettu"); sahibe ödenen
OKUR: params.DIV_TAX, params.CORP_TAX. YAZAR: yalnız verilen L (Ledger.pay).
KATMAN: L0 (yalnız params'a bağlı).
"""
from simkit.params import *          # noqa: F401,F403


def corp_tax_pay(L, frm, city_acct, x):
    if CORP_TAX > 0:
        L.pay(frm, city_acct, CORP_TAX * x, "kurumlar_vergisi")
        return (1 - CORP_TAX) * x
    return x


def div_tax(x):
    return DIV_TAX * x


def div_net(x):
    return (1 - DIV_TAX) * x


def pay_div_tax(L, frm, city_acct, x):
    return L.pay(frm, city_acct, div_tax(x), "temettu_vergisi")


def pay_holders(L, frm, holders, net):
    """Hissedarlara payları kadar öder; sahibe kalan net tutarı döndürür (net * (1 - toplam pay))."""
    for inv_, h_ in holders.items():
        h_["div"] += L.pay(frm, inv_, net * h_["share"], "kar_payi_dagitimi")
    return net * (1.0 - sum(h_["share"] for h_ in holders.values()))


def pay_owner_dividend(L, frm, city_acct, owner, x, holders=None):
    """Temettü: stopaj, (varsa) hissedarlar, sahip. Sahibe ödenen tutarı döndürür. K-188 kurumlar vergisi BURADA alınmaz:
    çağıran, dağıtılacak x'i önce corp_tax_pay ile vergi sonrasına indirir (pay_w gibi kayıtlar vergi sonrası x'i görür)."""
    pay_div_tax(L, frm, city_acct, x)
    net = div_net(x)
    if holders:
        net = pay_holders(L, frm, holders, net)
    return L.pay(frm, owner, net, "temettu")
