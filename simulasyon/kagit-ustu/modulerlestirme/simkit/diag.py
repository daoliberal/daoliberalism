"""simkit.diag: tanı işlevleri (davranışı etkilemeyen ölçümler).

ARAYÜZ: gate_no
OKUR: W.chain, W.gate (yalnız tanı sayaçları). YAZAR: W.gate.
KATMAN: L0 (hiçbir simkit modülüne bağımlı değil).
"""
from simkit.params import *          # noqa: F401,F403


def gate_no(W, why, p=None, extra=None):
    NOW = W.NOW
    chain = W.chain
    gate = W.gate
    gate[(NOW[0] // 25 * 25, why)] += 1
    if p is not None and why == 'girdi_kit':
        gate[(NOW[0] // 25 * 25, 'girdi_kit:' + str(p))] += 1
    if p is not None:
        chain[(NOW[0] // 25 * 25, p)][why] += 1
        if extra is not None:
            chain[(NOW[0] // 25 * 25, p)]["girdi:" + str(extra)] += 1
    return False
