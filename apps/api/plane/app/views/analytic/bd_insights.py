# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
BD Insights analytics endpoint.

A single admin-only endpoint that powers the six BD Insights widgets. It reuses
AdvanceAnalyticsBaseView.initialize_workspace, so the created_at date-range
filter (date_filter / start_date / end_date -> chart_period_range) and the
project_ids scoping are applied to the base queryset exactly like the rest of
advance analytics, before any grouping or aggregation.

Two measures are deliberate approximations, surfaced in the API and labelled as
such in the UI:
  * time-to-close is WON-ONLY ("avg days to win"). Cancelled leads have no close
    timestamp (Issue.completed_at is only set for the completed state group), so
    they are excluded rather than guessed at.
  * the "funnel" is a point-in-time snapshot of how many leads currently sit in
    each state (ordered by the state's pipeline sequence). It is NOT a historical
    progression/drop-off; the UI labels it "current distribution by stage".
"""

import uuid
from collections import defaultdict
from datetime import timedelta
from typing import Any, Dict, List, Optional

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, FilteredRelation, Q, QuerySet, Sum
from django.db.models.functions import TruncWeek
from django.http import HttpRequest
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.analytic.advance import AdvanceAnalyticsBaseView
from plane.db.models import Issue
from plane.db.models.custom_field import CustomFieldDefinition, CustomFieldType, CustomFieldValue
from plane.utils.bd_deal_value import DEFAULT_HOURS_PER_WEEK, estimate_deal_value
from plane.utils.build_chart import build_leads_wins_by_field

# State groups that count as "closed" for win-rate purposes.
CLOSED_GROUPS = ["completed", "cancelled"]
WON_GROUP = "completed"
LOST_GROUP = "cancelled"

# State groups on the forward funnel path. Cancelled (lost) leads are off the
# forward path and reported as drop-outs; triage/None have no place in the funnel.
# Ordering WITHIN the funnel is by state.sequence, not by this set — a late state
# like "Client Still Looking" is group=unstarted yet sits near the end (high
# sequence), so group can't be used to order.
FORWARD_GROUPS = {"backlog", "unstarted", "started", "completed"}


def _win_rate(won: int, closed: int) -> Optional[float]:
    """won / closed as a percentage, or None when nothing has closed.

    won is always a subset of closed within the same queryset, so the result is
    bounded to [0, 100] by construction -- a multi-assignee lead cannot push a
    per-BD row above 100%.
    """
    if not closed:
        return None
    return round((won / closed) * 100, 1)


def _duration_to_days(value: Optional[timedelta]) -> Optional[float]:
    if value is None:
        return None
    return round(value.total_seconds() / 86400, 1)


class BDInsightsEndpoint(AdvanceAnalyticsBaseView):
    """Admin-only. `type` selects the widget aggregation."""

    def get_scoped_queryset(self) -> QuerySet[Issue]:
        """Base issue queryset with workspace/project filters and the created_at
        date-range scope applied (identical to the other advance-analytics
        chart endpoints)."""
        queryset = Issue.issue_objects.filter(**self.filters["base_filters"])
        if self.filters["chart_period_range"]:
            start_date, end_date = self.filters["chart_period_range"]
            queryset = queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)
        return queryset

    # ---- 1. Win rate % (overall + per BD) ----
    def win_rate(self) -> Dict[str, Any]:
        queryset = self.get_scoped_queryset()

        # Overall is computed from the full queryset (never summed from per-BD
        # rows), so overlapping assignees can't distort it.
        overall = queryset.aggregate(
            won=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
            closed=Count("id", filter=Q(state__group__in=CLOSED_GROUPS), distinct=True),
        )

        per_bd_rows = (
            queryset.filter(assignees__isnull=False, issue_assignee__deleted_at__isnull=True)
            .values("assignees__id", "assignees__display_name")
            .annotate(
                won=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
                closed=Count("id", filter=Q(state__group__in=CLOSED_GROUPS), distinct=True),
            )
            .order_by("-won")
        )

        return {
            "overall": {
                "won": overall["won"] or 0,
                "closed": overall["closed"] or 0,
                "win_rate": _win_rate(overall["won"] or 0, overall["closed"] or 0),
            },
            "per_bd": [
                {
                    "assignee_id": str(row["assignees__id"]),
                    "assignee_name": row["assignees__display_name"],
                    "won": row["won"],
                    "closed": row["closed"],
                    "win_rate": _win_rate(row["won"], row["closed"]),
                }
                for row in per_bd_rows
            ],
        }

    # ---- 2. Current distribution by stage (snapshot, NOT a historical funnel) ----
    def stage_distribution(self) -> Dict[str, Any]:
        data = (
            self.get_scoped_queryset()
            .values("state__id", "state__name", "state__group", "state__sequence")
            .annotate(count=Count("id", distinct=True))
            .order_by("state__sequence")
        )
        return {
            "data": [
                {
                    "key": str(item["state__id"]),
                    "name": item["state__name"],
                    "group": item["state__group"],
                    "count": item["count"],
                }
                for item in data
            ]
        }

    # ---- 2b. Stage-conversion funnel (current-snapshot, cumulative) ----
    def conversion_funnel(self) -> Dict[str, Any]:
        """A funnel built from the *current* stage of each lead, not historical
        transitions (state-change history is not reliably recorded for imported
        leads). Ordering is by state group then sequence; cancelled leads are the
        drop-out bucket (their furthest stage is unknown, so they are reported
        separately rather than distributed across stages).

        reached(stage) = leads currently sitting at that stage OR any later
        forward stage (a lead in a later stage necessarily passed through the
        earlier ones). conversion_to_next = reached(next)/reached(stage); the
        stage with the largest relative stall is flagged as the biggest leak.
        """
        rows = (
            self.get_scoped_queryset()
            .filter(state__isnull=False)
            .values("state__id", "state__name", "state__group", "state__sequence")
            .annotate(count=Count("id", distinct=True))
        )

        lost_count = 0
        forward: List[Dict[str, Any]] = []
        for r in rows:
            group = r["state__group"]
            if group == LOST_GROUP:
                lost_count += r["count"]
                continue
            if group not in FORWARD_GROUPS:  # triage / unknown -> not on the funnel
                continue
            forward.append(
                {
                    "key": str(r["state__id"]),
                    "name": r["state__name"],
                    "group": group,
                    "count": r["count"],
                    "sequence": r["state__sequence"] if r["state__sequence"] is not None else 0,
                }
            )

        # Order by the state's own sequence — the authoritative pipeline order the
        # user configured (Applied → … → Client Still Looking → Won). Group would
        # misplace late unstarted states.
        forward.sort(key=lambda s: s["sequence"])

        # Cumulative "reached" from the last forward stage backwards.
        reached = 0
        for stage in reversed(forward):
            reached += stage["count"]
            stage["reached"] = reached

        entered_count = forward[0]["reached"] if forward else 0

        stages: List[Dict[str, Any]] = []
        biggest_leak_index: Optional[int] = None
        worst_stall = -1.0
        for i, stage in enumerate(forward):
            conversion_to_next: Optional[float] = None
            is_last = i == len(forward) - 1
            if not is_last and stage["reached"]:
                next_reached = forward[i + 1]["reached"]
                conversion_to_next = round(next_reached / stage["reached"] * 100, 1)
                stall_rate = (stage["reached"] - next_reached) / stage["reached"]
                if stall_rate > worst_stall:
                    worst_stall = stall_rate
                    biggest_leak_index = i
            stages.append(
                {
                    "key": stage["key"],
                    "name": stage["name"],
                    "group": stage["group"],
                    "count": stage["count"],
                    "reached": stage["reached"],
                    "conversion_to_next": conversion_to_next,
                }
            )

        return {
            "assumption": "current_snapshot_cumulative",
            "entered_count": entered_count,
            "lost_count": lost_count,
            "biggest_leak_index": biggest_leak_index,
            "stages": stages,
        }

    # ---- 3. Avg time-to-close (WON-ONLY approximation) ----
    def time_to_close(self) -> Dict[str, Any]:
        won_queryset = self.get_scoped_queryset().filter(state__group=WON_GROUP, completed_at__isnull=False)
        ttc = ExpressionWrapper(F("completed_at") - F("created_at"), output_field=DurationField())

        overall = won_queryset.aggregate(avg=Avg(ttc), count=Count("id", distinct=True))

        per_bd_rows = (
            won_queryset.filter(assignees__isnull=False, issue_assignee__deleted_at__isnull=True)
            .values("assignees__id", "assignees__display_name")
            .annotate(avg=Avg(ttc), count=Count("id", distinct=True))
            .order_by("avg")
        )

        return {
            "approximation": "won_only",
            "overall": {
                "avg_days": _duration_to_days(overall["avg"]),
                "count": overall["count"] or 0,
            },
            "per_bd": [
                {
                    "assignee_id": str(row["assignees__id"]),
                    "assignee_name": row["assignees__display_name"],
                    "avg_days": _duration_to_days(row["avg"]),
                    "count": row["count"],
                }
                for row in per_bd_rows
            ],
        }

    # ---- 3b. Avg cycle length by segment (created_at -> Won, per single-select) ----
    def cycle_by_field(self) -> Response:
        """Avg days from lead creation to Won, bucketed by a single-select field
        (Profile / Country) — the cycle length kept per-segment, not blended, so
        a slow segment can't hide behind a fast one. Won leads only (only they
        have a close date)."""
        field_id = self._validated_field_id(CustomFieldType.SINGLE_SELECT)
        if field_id is None:
            return Response({"error": "A valid single-select `field_id` is required"}, status=status.HTTP_400_BAD_REQUEST)

        won = self.get_scoped_queryset().filter(state__group=WON_GROUP, completed_at__isnull=False)
        ttc = ExpressionWrapper(F("completed_at") - F("created_at"), output_field=DurationField())
        alias = "cf_cycle"
        rows = (
            won.annotate(
                **{alias: FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=field_id))}
            )
            .values(f"{alias}__value_option_id", f"{alias}__value_option__name")
            .annotate(avg=Avg(ttc), count=Count("id", distinct=True))
            .order_by("avg")
        )
        data = [
            {
                "key": str(r[f"{alias}__value_option_id"]) if r[f"{alias}__value_option_id"] else "none",
                "name": r[f"{alias}__value_option__name"] or "None",
                "avg_days": _duration_to_days(r["avg"]),
                "count": r["count"],
            }
            for r in rows
        ]
        return Response({"field_id": str(field_id), "data": data}, status=status.HTTP_200_OK)

    # ---- 4c. Sales velocity ($/day) ----
    def velocity(self) -> Response:
        """Sales velocity = (open opps × avg deal value × win rate) / avg cycle
        length, in $/day. All four inputs are returned alongside so the figure is
        legible, not a black box. Avg deal value uses the deal-value proxy over
        Won leads (an ESTIMATE); velocity is null until every input is available.
        """
        rate_id = self._validated_field_id(CustomFieldType.TEXT, param="rate_field_id")
        weeks_id = self._validated_field_id(CustomFieldType.NUMBER, param="weeks_field_id")
        contract_id = self._validated_field_id(CustomFieldType.SINGLE_SELECT, param="contract_field_id")
        hours_per_week = self._float_param("hours_per_week", DEFAULT_HOURS_PER_WEEK)

        qs = self.get_scoped_queryset()
        counts = qs.aggregate(
            won=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
            closed=Count("id", filter=Q(state__group__in=CLOSED_GROUPS), distinct=True),
        )
        won_count = counts["won"] or 0
        win_rate = _win_rate(won_count, counts["closed"] or 0)

        # Open opportunities = active pipeline: has a state, not yet closed (won/lost).
        open_opps = qs.filter(state__isnull=False).exclude(state__group__in=CLOSED_GROUPS).count()

        ttc = ExpressionWrapper(F("completed_at") - F("created_at"), output_field=DurationField())
        avg_cycle_days = _duration_to_days(
            qs.filter(state__group=WON_GROUP, completed_at__isnull=False).aggregate(avg=Avg(ttc))["avg"]
        )

        revenue_enabled = rate_id is not None and contract_id is not None
        avg_deal_value: Optional[float] = None
        counted = 0
        excluded = 0
        if revenue_enabled:
            won_ids = list(qs.filter(state__group=WON_GROUP).values_list("id", flat=True))
            per_issue = self._collect_field_values(won_ids, [fid for fid in (rate_id, weeks_id, contract_id) if fid])
            total = 0.0
            for issue_id in won_ids:
                fields = per_issue.get(issue_id, {})
                weeks = fields.get(weeks_id, {}).get("number") if weeks_id else None
                value = estimate_deal_value(
                    fields.get(rate_id, {}).get("text"),
                    float(weeks) if weeks is not None else None,
                    fields.get(contract_id, {}).get("option"),
                    hours_per_week,
                )
                if value is None:
                    excluded += 1
                else:
                    total += value
                    counted += 1
            avg_deal_value = round(total / counted, 1) if counted else None

        velocity_per_day: Optional[float] = None
        if avg_deal_value is not None and win_rate is not None and avg_cycle_days:
            velocity_per_day = round(open_opps * avg_deal_value * (win_rate / 100) / avg_cycle_days, 1)

        return Response(
            {
                "revenue_enabled": revenue_enabled,
                "hours_per_week": hours_per_week,
                "open_opps": open_opps,
                "avg_deal_value": avg_deal_value,
                "win_rate": win_rate,
                "avg_cycle_days": avg_cycle_days,
                "velocity_per_day": velocity_per_day,
                "won_value_counted": counted,
                "won_value_excluded": excluded,
            },
            status=status.HTTP_200_OK,
        )

    # ---- 4d. Weighted pipeline forecast ----
    def forecast(self) -> Response:
        """Weighted pipeline value: each OPEN lead is weighted by the win
        probability of its current stage and multiplied by its estimated deal
        value; the sum is the forecast. Stage win probability is a
        current-snapshot proxy — P(win | at stage) = won / leads that reached
        that stage (state-change history isn't reliably recorded, so we can't
        use true historical transition rates). Deal value is the same estimate
        proxy used elsewhere; open leads with an unparseable rate are excluded
        and counted."""
        rate_id = self._validated_field_id(CustomFieldType.TEXT, param="rate_field_id")
        weeks_id = self._validated_field_id(CustomFieldType.NUMBER, param="weeks_field_id")
        contract_id = self._validated_field_id(CustomFieldType.SINGLE_SELECT, param="contract_field_id")
        hours_per_week = self._float_param("hours_per_week", DEFAULT_HOURS_PER_WEEK)

        qs = self.get_scoped_queryset()

        # Cumulative "reached" per forward state (identical basis to the funnel),
        # plus the total won count, to derive each stage's win probability.
        state_rows = (
            qs.filter(state__isnull=False)
            .values("state__id", "state__group", "state__sequence")
            .annotate(count=Count("id", distinct=True))
        )
        won_count = 0
        forward: List[Dict[str, Any]] = []
        for r in state_rows:
            group = r["state__group"]
            if group == WON_GROUP:
                won_count += r["count"]
            if group not in FORWARD_GROUPS:
                continue
            forward.append(
                {
                    "id": r["state__id"],
                    "count": r["count"],
                    "sequence": r["state__sequence"] if r["state__sequence"] is not None else 0,
                }
            )
        forward.sort(key=lambda s: s["sequence"])
        reached_by_state: Dict[Any, int] = {}
        reached = 0
        for stage in reversed(forward):
            reached += stage["count"]
            reached_by_state[stage["id"]] = reached

        def win_prob(state_id: Any) -> float:
            r = reached_by_state.get(state_id)
            if not r:
                return 0.0
            return min(won_count / r, 1.0)

        # Open leads = active pipeline (has a state, not closed).
        open_leads = list(
            qs.filter(state__isnull=False)
            .exclude(state__group__in=CLOSED_GROUPS)
            .values("id", "state__id", "state__name", "state__sequence")
        )
        per_issue = self._collect_field_values(
            [lead["id"] for lead in open_leads], [fid for fid in (rate_id, weeks_id, contract_id) if fid]
        )
        revenue_enabled = rate_id is not None and contract_id is not None

        stage_agg: Dict[Any, Dict[str, Any]] = {}
        forecast_value = 0.0
        open_valued = 0
        open_excluded = 0
        for lead in open_leads:
            state_id = lead["state__id"]
            prob = win_prob(state_id)
            agg = stage_agg.setdefault(
                state_id,
                {
                    "name": lead["state__name"],
                    "sequence": lead["state__sequence"] if lead["state__sequence"] is not None else 0,
                    "win_prob": round(prob * 100, 1),
                    "open_count": 0,
                    "weighted_value": 0.0,
                },
            )
            agg["open_count"] += 1

            if revenue_enabled:
                fields = per_issue.get(lead["id"], {})
                weeks = fields.get(weeks_id, {}).get("number") if weeks_id else None
                value = estimate_deal_value(
                    fields.get(rate_id, {}).get("text"),
                    float(weeks) if weeks is not None else None,
                    fields.get(contract_id, {}).get("option"),
                    hours_per_week,
                )
                if value is None:
                    open_excluded += 1
                else:
                    weighted = value * prob
                    agg["weighted_value"] += weighted
                    forecast_value += weighted
                    open_valued += 1

        stages = sorted(stage_agg.values(), key=lambda s: s["sequence"])
        for s in stages:
            s["weighted_value"] = round(s["weighted_value"], 1)
            del s["sequence"]

        return Response(
            {
                "revenue_enabled": revenue_enabled,
                "hours_per_week": hours_per_week,
                "forecast_value": round(forecast_value, 1) if revenue_enabled else None,
                "open_total": len(open_leads),
                "open_valued": open_valued,
                "open_excluded": open_excluded,
                "stages": stages,
            },
            status=status.HTTP_200_OK,
        )

    # ---- 5d. Loss-reason breakdown (lost leads by a single-select field) ----
    def loss_reasons(self) -> Response:
        """Breakdown of LOST leads by a single-select field (typically a
        "Loss Reason" field the admin adds in project settings). Resolved by id
        like the other by-field widgets, so it degrades gracefully until the
        field exists."""
        field_id = self._validated_field_id(CustomFieldType.SINGLE_SELECT)
        if field_id is None:
            return Response({"error": "A valid single-select `field_id` is required"}, status=status.HTTP_400_BAD_REQUEST)

        lost = self.get_scoped_queryset().filter(state__group=LOST_GROUP)
        alias = "cf_loss"
        rows = (
            lost.annotate(
                **{alias: FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=field_id))}
            )
            .values(f"{alias}__value_option_id", f"{alias}__value_option__name")
            .annotate(count=Count("id", distinct=True))
            .order_by("-count")
        )
        data = [
            {
                "key": str(r[f"{alias}__value_option_id"]) if r[f"{alias}__value_option_id"] else "none",
                "name": r[f"{alias}__value_option__name"] or "Unspecified",
                "count": r["count"],
            }
            for r in rows
        ]
        return Response(
            {"field_id": str(field_id), "total": sum(r["count"] for r in data), "data": data},
            status=status.HTTP_200_OK,
        )

    # ---- 4. Leads & wins by a single-select custom field (Profile / Country) ----
    def by_field(self) -> Response:
        field_id = self._validated_field_id(CustomFieldType.SINGLE_SELECT)
        if field_id is None:
            return Response(
                {"error": "A valid single-select `field_id` is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {"field_id": str(field_id), "data": build_leads_wins_by_field(self.get_scoped_queryset(), field_id)},
            status=status.HTTP_200_OK,
        )

    # ---- 5. Connects efficiency ----
    def connects(self) -> Response:
        spent_field_id = self._validated_field_id(CustomFieldType.NUMBER, param="spent_field_id")
        if spent_field_id is None:
            return Response(
                {"error": "A valid number `spent_field_id` is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        boost_field_id = self._validated_field_id(CustomFieldType.NUMBER, param="boost_field_id")

        queryset = self.get_scoped_queryset().annotate(
            cf_spent=FilteredRelation(
                "custom_field_values", condition=Q(custom_field_values__field_id=spent_field_id)
            )
        )
        aggregates = queryset.aggregate(
            spent_total=Sum("cf_spent__value_number"),
            spent_on_won=Sum("cf_spent__value_number", filter=Q(state__group=WON_GROUP)),
            spent_on_lost=Sum("cf_spent__value_number", filter=Q(state__group=LOST_GROUP)),
            won_count=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
        )

        spent_on_won = aggregates["spent_on_won"] or 0
        won_count = aggregates["won_count"] or 0
        data = {
            "spent_total": aggregates["spent_total"] or 0,
            "spent_on_won": spent_on_won,
            "spent_on_lost": aggregates["spent_on_lost"] or 0,
            "won_count": won_count,
            "connects_per_win": round(spent_on_won / won_count, 1) if won_count else None,
        }

        if boost_field_id is not None:
            boost = (
                self.get_scoped_queryset()
                .annotate(
                    cf_boost=FilteredRelation(
                        "custom_field_values", condition=Q(custom_field_values__field_id=boost_field_id)
                    )
                )
                .aggregate(
                    boost_total=Sum("cf_boost__value_number"),
                    boost_on_won=Sum("cf_boost__value_number", filter=Q(state__group=WON_GROUP)),
                )
            )
            data["boost_total"] = boost["boost_total"] or 0
            data["boost_on_won"] = boost["boost_on_won"] or 0

        return Response(data, status=status.HTTP_200_OK)

    # ---- 5b. Connects economics by segment (connects ROI + revenue-per-connect) ----
    def economics_by_segment(self) -> Response:
        """Per-slice connects economics for a single-select segment (Profile /
        Country / …). Combines three of the requested views in one pass:
          - connects spent per won deal  (connects_per_win)
          - total connects spent vs deals won  (spent_total vs wins -> wasted connects)
          - revenue per connect  (est. won deal value / connects spent on won)

        Segment + connects come from custom fields; revenue uses the deal-value
        proxy (Rate / No. of Weeks / Contract Type). Revenue fields are optional
        — when absent, revenue metrics come back null and connects metrics still
        work. Everything is computed per-lead in Python (the per-project lead
        count is small) so the branch-on-contract-type proxy stays readable.
        """
        seg_id = self._validated_field_id(CustomFieldType.SINGLE_SELECT, param="field_id")
        spent_id = self._validated_field_id(CustomFieldType.NUMBER, param="spent_field_id")
        if seg_id is None or spent_id is None:
            return Response(
                {"error": "Valid single-select `field_id` and number `spent_field_id` are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Optional deal-value inputs — revenue metrics degrade gracefully if missing.
        rate_id = self._validated_field_id(CustomFieldType.TEXT, param="rate_field_id")
        weeks_id = self._validated_field_id(CustomFieldType.NUMBER, param="weeks_field_id")
        contract_id = self._validated_field_id(CustomFieldType.SINGLE_SELECT, param="contract_field_id")
        hours_per_week = self._float_param("hours_per_week", DEFAULT_HOURS_PER_WEEK)
        revenue_enabled = rate_id is not None and contract_id is not None

        issues = {row["id"]: row["state__group"] for row in self.get_scoped_queryset().values("id", "state__group")}
        field_ids = [fid for fid in (seg_id, spent_id, rate_id, weeks_id, contract_id) if fid is not None]
        per_issue = self._collect_field_values(list(issues), field_ids)

        buckets: Dict[str, Dict[str, Any]] = {}

        def bucket(name: str) -> Dict[str, Any]:
            return buckets.setdefault(
                name,
                {
                    "leads": 0, "wins": 0, "closed": 0,
                    "spent_total": 0.0, "spent_on_won": 0.0,
                    "won_value": 0.0, "won_value_counted": 0, "won_value_excluded": 0,
                },
            )

        for issue_id, group in issues.items():
            fields = per_issue.get(issue_id, {})
            seg_name = fields.get(seg_id, {}).get("option") or "None"
            spent = float(fields.get(spent_id, {}).get("number") or 0)
            b = bucket(seg_name)
            b["leads"] += 1
            b["spent_total"] += spent
            if group in CLOSED_GROUPS:
                b["closed"] += 1
            if group == WON_GROUP:
                b["wins"] += 1
                b["spent_on_won"] += spent
                if revenue_enabled:
                    weeks = fields.get(weeks_id, {}).get("number") if weeks_id else None
                    value = estimate_deal_value(
                        fields.get(rate_id, {}).get("text"),
                        float(weeks) if weeks is not None else None,
                        fields.get(contract_id, {}).get("option"),
                        hours_per_week,
                    )
                    if value is None:
                        b["won_value_excluded"] += 1
                    else:
                        b["won_value"] += value
                        b["won_value_counted"] += 1

        rows: List[Dict[str, Any]] = []
        for name, b in buckets.items():
            has_revenue = revenue_enabled and b["won_value_counted"] > 0 and b["spent_on_won"] > 0
            rows.append(
                {
                    "key": name,
                    "name": name,
                    "leads": b["leads"],
                    "wins": b["wins"],
                    "closed": b["closed"],
                    "win_rate": _win_rate(b["wins"], b["closed"]),
                    "spent_total": round(b["spent_total"], 1),
                    "spent_on_won": round(b["spent_on_won"], 1),
                    "connects_per_win": round(b["spent_on_won"] / b["wins"], 1) if b["wins"] else None,
                    "won_value": round(b["won_value"], 1) if has_revenue else None,
                    "revenue_per_connect": round(b["won_value"] / b["spent_on_won"], 1) if has_revenue else None,
                    "won_value_excluded": b["won_value_excluded"],
                }
            )
        # Descending by connects spent — the "where are connects going" ordering.
        rows.sort(key=lambda r: r["spent_total"], reverse=True)

        return Response(
            {
                "revenue_enabled": revenue_enabled,
                "hours_per_week": hours_per_week,
                "data": rows,
            },
            status=status.HTTP_200_OK,
        )

    # ---- 5c. Boosted vs non-boosted effectiveness ----
    def boosted_effectiveness(self) -> Response:
        """Does boosting a proposal pay off? Splits leads on the "Boosted
        Proposal?" checkbox and reports win rate and connects-per-win for each
        bucket so the two are directly comparable."""
        flag_id = self._validated_field_id(CustomFieldType.CHECKBOX, param="flag_field_id")
        spent_id = self._validated_field_id(CustomFieldType.NUMBER, param="spent_field_id")
        if flag_id is None or spent_id is None:
            return Response(
                {"error": "Valid checkbox `flag_field_id` and number `spent_field_id` are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        issues = {row["id"]: row["state__group"] for row in self.get_scoped_queryset().values("id", "state__group")}
        per_issue = self._collect_field_values(list(issues), [flag_id, spent_id])

        # Two fixed buckets so the response shape is stable even if one is empty.
        agg = {
            True: {"won": 0, "closed": 0, "leads": 0, "spent_on_won": 0.0},
            False: {"won": 0, "closed": 0, "leads": 0, "spent_on_won": 0.0},
        }
        for issue_id, group in issues.items():
            fields = per_issue.get(issue_id, {})
            boosted = bool(fields.get(flag_id, {}).get("boolean"))
            spent = float(fields.get(spent_id, {}).get("number") or 0)
            b = agg[boosted]
            b["leads"] += 1
            if group in CLOSED_GROUPS:
                b["closed"] += 1
            if group == WON_GROUP:
                b["won"] += 1
                b["spent_on_won"] += spent

        def shape(label: str, b: Dict[str, Any]) -> Dict[str, Any]:
            return {
                "key": label,
                "name": label,
                "leads": b["leads"],
                "won": b["won"],
                "closed": b["closed"],
                "win_rate": _win_rate(b["won"], b["closed"]),
                "connects_per_win": round(b["spent_on_won"] / b["won"], 1) if b["won"] else None,
            }

        return Response(
            {"data": [shape("Boosted", agg[True]), shape("Not boosted", agg[False])]},
            status=status.HTTP_200_OK,
        )

    def _float_param(self, param: str, default: float) -> float:
        """Parse a positive float query param, falling back to default."""
        raw = self.request.GET.get(param, None)
        if not raw:
            return default
        try:
            value = float(raw)
        except (ValueError, TypeError):
            return default
        return value if value > 0 else default

    def _collect_field_values(
        self, issue_ids: List[uuid.UUID], field_ids: List[uuid.UUID]
    ) -> Dict[uuid.UUID, Dict[uuid.UUID, Dict[str, Any]]]:
        """Load the given custom-field values for the given issues in one query,
        keyed as {issue_id: {field_id: {text, number, boolean, option}}}. Lets a
        caller read several typed fields per lead without a join per field."""
        result: Dict[uuid.UUID, Dict[uuid.UUID, Dict[str, Any]]] = defaultdict(dict)
        if not issue_ids or not field_ids:
            return result
        values = CustomFieldValue.objects.filter(issue_id__in=issue_ids, field_id__in=field_ids).values(
            "issue_id", "field_id", "value_text", "value_number", "value_boolean", "value_option__name"
        )
        for v in values:
            result[v["issue_id"]][v["field_id"]] = {
                "text": v["value_text"],
                "number": v["value_number"],
                "boolean": v["value_boolean"],
                "option": v["value_option__name"],
            }
        return result

    # ---- 6. Trend over time (weekly) ----
    def trend(self) -> Dict[str, Any]:
        # Leads bucketed by created_at week (already scoped to the range).
        created_rows = (
            self.get_scoped_queryset()
            .annotate(week=TruncWeek("created_at"))
            .values("week")
            .annotate(count=Count("id", distinct=True))
            .order_by("week")
        )

        # Wins bucketed by completed_at week (when the win happened), scoped to
        # the same range on completed_at.
        wins_queryset = Issue.issue_objects.filter(
            **self.filters["base_filters"], state__group=WON_GROUP, completed_at__isnull=False
        )
        if self.filters["chart_period_range"]:
            start_date, end_date = self.filters["chart_period_range"]
            wins_queryset = wins_queryset.filter(completed_at__date__gte=start_date, completed_at__date__lte=end_date)
        wins_rows = (
            wins_queryset.annotate(week=TruncWeek("completed_at"))
            .values("week")
            .annotate(count=Count("id", distinct=True))
            .order_by("week")
        )

        created_by_week = {row["week"].date(): row["count"] for row in created_rows if row["week"]}
        wins_by_week = {row["week"].date(): row["count"] for row in wins_rows if row["week"]}

        all_weeks = sorted(set(created_by_week) | set(wins_by_week))
        if not all_weeks:
            return {"data": []}

        # Zero-fill contiguous weeks between the first and last week with data so
        # the line has no gaps.
        data = []
        current = all_weeks[0]
        last = all_weeks[-1]
        while current <= last:
            data.append(
                {
                    "week": current.strftime("%Y-%m-%d"),
                    "created": created_by_week.get(current, 0),
                    "wins": wins_by_week.get(current, 0),
                }
            )
            current = current + timedelta(weeks=1)

        return {"data": data}

    def _validated_field_id(
        self, field_type: CustomFieldType, param: str = "field_id"
    ) -> Optional[uuid.UUID]:
        """Parse `param` as a UUID and confirm it is an active custom field of
        the expected type inside the scoped workspace/projects. Returns None on
        any mismatch so callers can 400."""
        raw = self.request.GET.get(param, None)
        if not raw:
            return None
        try:
            field_id = uuid.UUID(raw)
        except (ValueError, TypeError):
            return None

        definition_query = CustomFieldDefinition.objects.filter(
            id=field_id,
            workspace__slug=self._workspace_slug,
            field_type=field_type,
            is_active=True,
        )
        project_ids = self.request.GET.get("project_ids", None)
        if project_ids:
            definition_query = definition_query.filter(
                project_id__in=[pid for pid in project_ids.split(",")]
            )
        if not definition_query.exists():
            return None
        return field_id

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def get(self, request: HttpRequest, slug: str) -> Response:
        self.initialize_workspace(slug, type="chart")
        insight_type = request.GET.get("type", None)

        # Handlers that own their Response (they may 400 on bad params).
        if insight_type == "by-field":
            return self.by_field()
        if insight_type == "connects":
            return self.connects()
        if insight_type == "economics-by-segment":
            return self.economics_by_segment()
        if insight_type == "boosted":
            return self.boosted_effectiveness()
        if insight_type == "cycle-by-field":
            return self.cycle_by_field()
        if insight_type == "velocity":
            return self.velocity()
        if insight_type == "forecast":
            return self.forecast()
        if insight_type == "loss-reasons":
            return self.loss_reasons()

        # Handlers that return a plain payload.
        dispatch = {
            "win-rate": self.win_rate,
            "funnel": self.stage_distribution,
            "conversion-funnel": self.conversion_funnel,
            "time-to-close": self.time_to_close,
            "trend": self.trend,
        }
        handler = dispatch.get(insight_type)
        if handler is None:
            return Response({"error": "Invalid or missing `type`"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(handler(), status=status.HTTP_200_OK)
