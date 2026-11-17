"""Dünya kodu: 7 karakter, karışabilen karakterler (0 O 1 I L) yok."""
from __future__ import annotations

import secrets
from typing import Callable

ALFABE = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
UZUNLUK = 7
_DENEME = 64


def yeni_kod(var_mi: Callable[[str], bool]) -> str:
    for _ in range(_DENEME):
        k = "".join(secrets.choice(ALFABE) for _ in range(UZUNLUK))
        if not var_mi(k):
            return k
    raise RuntimeError("kod üretilemedi")


def normalize_kod(s: object) -> str | None:
    """Kırpar, büyük harfe çevirir; uzunluk ya da alfabe uymuyorsa `None`."""
    if not isinstance(s, str):
        return None
    k = s.strip().upper()
    if len(k) != UZUNLUK or any(c not in ALFABE for c in k):
        return None
    return k
