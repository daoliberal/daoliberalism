"""simkit.engine: bir koşunun ana döngüsü (plan v2 adım 7c).

AMAÇ: kurulmuş bir World üzerinde haftaları sırayla oynatır (`week_step`). Koşu durumunun başlangıç değerleri (haftalar arası taşınan
geçici adlar `W.ad`) burada atanır. Kurulum `world_init.new_world`, sonuç derleme `World.results()` (simkit.results) işidir.
ARAYÜZ: start_world(W) (D7: dünya kurulumu start_setup burada), run_world(W, weeks)
OKUR/YAZAR: W (bütün koşu durumu).
KATMAN: L9 (en üst; step'e bağlı).
"""
from simkit.params import START_EMP, START_DEMAND, CAP_MODE, CAP_GROWTH, HOUSE_MODE
from simkit.labor import start_setup
from simkit.step import week_step
from simkit.measure import measure_finish


def start_world(W):
    """Haftalar arası taşınan geçici adların başlangıç değerleri (iç içe/dönüşümlü koşu için run_world'den ayrı)."""
    W.last_short = {}
    W.last_root_short = {}
    W.last_root_short_val = {}
    W.week_no = 1
    W.carriers_of = {}
    W.prod_last, W.want_last = {}, {}
    if START_EMP > 0 or START_DEMAND or CAP_MODE == 1 or CAP_GROWTH or HOUSE_MODE:     # D7: tutarlı dünya kurulumu (ilk hafta kadro kuralı gerekir: hafta başlamadan hemen önce); hepsi varsayılanda kapalı: yol değişmez
        start_setup(W)


def run_world(W, weeks):
    """weeks hafta oynatır; W değiştirilir (sonuç için W.results())."""
    start_world(W)
    for w in range(1, weeks + 1):
        week_step(W, w, weeks)
    measure_finish(W)                        # PX: WEEKLY_CSV açıksa CSV yazar (davranışsız)
