"""simkit.step: bir simülasyon haftasının faz sırası (plan v2 adım 7c).

AMAÇ: hafta döngüsü gövdesi 18 `phase_*` işlevinin sabit sırasıdır; `week_step(W, w, weeks)` bu fazları sırayla çağırır, `PHASES` aynı sırayı
ad olarak verir (belge ve test için). Fazlar arası durum `W` üzerindedir (hafta/döngü geçicileri `W.ad`).
ARAYÜZ: week_step(W, w, weeks), PHASES
OKUR/YAZAR: W (tüm hafta durumu).
KATMAN: L8 (orkestrasyon, hafta fazlarının üstünde).
"""
from simkit.week_open import phase_begin_week, phase_policy, phase_prices, phase_wages
from simkit.week_people import phase_migration, phase_staffing, phase_founding, phase_domestic, phase_cycle_setup
from simkit.week_cycles import phase_cycles
from simkit.week_close import phase_house_rent, phase_credit, phase_deposits, phase_dividends, phase_innov_end
from simkit.week_metrics import phase_metrics, phase_gates, phase_close


PHASES = (
    phase_begin_week,
    phase_policy,
    phase_prices,
    phase_wages,
    phase_migration,
    phase_staffing,
    phase_founding,
    phase_domestic,
    phase_cycle_setup,
    phase_cycles,
    phase_house_rent,
    phase_credit,
    phase_deposits,
    phase_dividends,
    phase_innov_end,
    phase_metrics,
    phase_gates,
    phase_close,
)


def week_step(W, w, weeks):
    """Bir haftayı oynatır: fazlar PHASES sırasıyla."""
    phase_begin_week(W, w)
    phase_policy(W, w)
    phase_prices(W, w)
    phase_wages(W, w)
    phase_migration(W, w)
    phase_staffing(W, w)
    phase_founding(W, w)
    phase_domestic(W, w)
    phase_cycle_setup(W)
    phase_cycles(W, w, weeks)
    phase_house_rent(W)
    phase_credit(W, w)
    phase_deposits(W, w)
    phase_dividends(W, w)
    phase_innov_end(W, w)
    phase_metrics(W, w, weeks)
    phase_gates(W, w, weeks)
    phase_close(W, w)
