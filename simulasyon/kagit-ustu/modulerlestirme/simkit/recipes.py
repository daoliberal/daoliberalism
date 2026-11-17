"""simkit.recipes: tarif topolojisi: koşu başı kopyası, yeniden kurma (rebuild_order) ve derinlik (depth).

ARAYÜZ: new_recipes, rebuild_order, reset_order, depth
OKUR: params.RECIPES0, TOPO0, PRODUCER (salt-okunur şablon). YAZAR: World'ün kendi W.RECIPES, W.TOPO, W.STAGES kopyaları (koşular birbirini etkilemez).
KATMAN: L0.
"""
from simkit.params import *          # noqa: F401,F403


def depth(W, kind):
    """Tarif derinliği: girdisiz tür 0; aksi halde girdi üreticilerinin en derini + 1 (W.RECIPES'in GÜNCEL girdileri üzerinden)."""
    inputs = W.RECIPES[kind][1]
    return 0 if not inputs else 1 + max(depth(W, PRODUCER[q]) for q in inputs)


def reset_order(W):
    """Koşu başında: şablon tariflerin kopyasını W'ye koyar (isteğe bağlı girdiler yok), TOPO ilk sıraya, STAGES yeniden hesaplanır."""
    W.RECIPES = {k: (dict(o), dict(i)) for k, (o, i) in RECIPES0.items()}
    W.TOPO = list(TOPO0)
    W.STAGES = [[k for k in W.TOPO if depth(W, k) == dpt] for dpt in range(1 + max(depth(W, k) for k in W.TOPO))]


def rebuild_order(W):
    """K-149 (inceleme): yeni isteğe bağlı girdi eklenince TOPO derinliğe göre kararlı yeniden sıralanır ve aşamalar yeniden hesaplanır (yerinde)."""
    W.TOPO[:] = sorted(W.TOPO, key=lambda k: depth(W, k))
    W.STAGES[:] = [[k for k in W.TOPO if depth(W, k) == dpt] for dpt in range(1 + max(depth(W, k) for k in W.TOPO))]
