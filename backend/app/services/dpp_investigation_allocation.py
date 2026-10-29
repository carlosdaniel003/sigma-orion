"""Limit attribution of confirmed quantities to the deficit of each PN.

The raw confirmation is kept as evidence.  Only the portion allocated to the
remaining shortage counts toward an explanation; never combine units or PNs.
"""
from __future__ import annotations

from collections.abc import Iterable

EPSILON = 1e-4


def allocate_cause(
    candidates: Iterable[dict],
    available_gap: float,
    *,
    confirmed_field: str,
    applied_field: str,
) -> tuple[float, float]:
    """Allocate once, in stable source order, returning raw total and applied total."""
    remaining = max(0.0, float(available_gap))
    confirmed = 0.0
    applied = 0.0
    for candidate in candidates:
        qty = max(0.0, float(candidate.get(confirmed_field) or 0.0))
        counted = min(qty, remaining)
        candidate[applied_field] = counted
        confirmed += qty
        applied += counted
        remaining = max(0.0, remaining - counted)
    return confirmed, applied
