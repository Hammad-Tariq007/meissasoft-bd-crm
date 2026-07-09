"""
Copyright (c) 2023-present Plane Software, Inc. and contributors
SPDX-License-Identifier: AGPL-3.0-only
See the LICENSE file for details.
"""

# Deal-value proxy for BD Leads analytics.
#
# There is no explicit "deal value" field; we estimate it from the Rate,
# No. of Weeks and Contract Type custom fields. The formula branches on
# Contract Type — the two contract shapes are NOT interchangeable:
#   - Hourly -> parsed_rate * hours_per_week * weeks
#              hours_per_week defaults to 30 (an honest agency default; 40
#              systematically overstates freelance/Upwork contracts).
#   - Fixed  -> the parsed rate IS the flat total; weeks are ignored.
# Leads whose Rate can't be parsed (or Hourly leads with no weeks, or an
# unrecognised Contract Type) are EXCLUDED from value metrics rather than
# counted as $0, so the numbers stay honest. Callers surface the excluded
# count. Every figure derived from this is an ESTIMATE and must be labelled
# as such in the UI.

import re
from typing import Optional

DEFAULT_HOURS_PER_WEEK = 30.0

# First number in the string, tolerating a leading currency symbol and thousands
# separators: "$45/hr" -> 45, "1,200 USD" -> 1200, "€30.50/h" -> 30.5.
_RATE_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)")


def parse_rate(text: Optional[str]) -> Optional[float]:
    """Extract the leading numeric rate from a free-text Rate value, or None."""
    if not text:
        return None
    match = _RATE_RE.search(text)
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def estimate_deal_value(
    rate_text: Optional[str],
    weeks: Optional[float],
    contract_type: Optional[str],
    hours_per_week: float = DEFAULT_HOURS_PER_WEEK,
) -> Optional[float]:
    """Estimated deal value, or None when the lead should be excluded from
    value metrics (unparseable rate / missing weeks on hourly / unknown
    contract type)."""
    rate = parse_rate(rate_text)
    if rate is None:
        return None

    kind = (contract_type or "").strip().lower()
    if kind == "hourly":
        if weeks is None:
            return None
        return rate * hours_per_week * float(weeks)
    if kind == "fixed":
        return rate
    # Unknown/blank contract type: we can't pick a formula, so exclude it.
    return None
