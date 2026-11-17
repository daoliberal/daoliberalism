"""simkit.world: World, bir koşunun bütün değişen durumunun kapsayıcısı (plan v2 adım 4a).

AMAÇ: bir koşunun BÜTÜN değişen durumu tek nesnede: `simkit.world_init.new_world(weeks, n_cities, ahir_kamu)` alanları atar (çalışma zamanı
kapsayıcıları her koşuda taze), `simkit.engine.run_world` haftaları oynatır, `W.results()` sonuç sözlüğünü verir. İşlevler `ad = W.ad`
takma ad prologuyla (aynı nesne, kopya yok) okur; iki World aynı süreçte birbirini etkilemez (tools/test_two_worlds.py).
ARAYÜZ: düz öznitelik kapsayıcı (alanlar new_world tarafından atanır; alt duruma bölme yapılmadı: alanlar eski yerel adlarını taşır).
KATMAN: bağımlılığı yok.
"""
from collections import defaultdict


class World:
    """Koşu durumu: alanlar new_world() içinde atanır (eski yerel adlarıyla)."""

    # results(): new_world W.results = partial(results, W) atar (simkit.world_init); gecikmeli içe aktarma paket kopyalarını karıştırırdı


# defaultdict fabrikaları (new_world içindeki `lambda: ...` ifadelerinin adlandırılmış karşılıkları; gövde metni aynen)
def fac_01():
    return dict(rev=0.0, inp=0.0, wc=0, rent=0.0)


def fac_02():
    return defaultdict(float)


def fac_03():
    return 1.0


def fac_04():
    return defaultdict(int)


def fac_05():
    return [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0]


def fac_06():
    return [0.0, 0.0, 0.0]


def fac_07():
    return dict(n=0, q=0.0, rev=0.0, buy=0.0, wage=0.0, w=0.0, prod=0.0, grade=1)


def fac_08():
    return [0.0, 0]


def fac_09():
    return [0.0, 0.0]


def fac_10():
    return -999


def fac_11():
    return 1


def fac_12():
    return 0.5
