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
from plane.db.models.custom_field import CustomFieldDefinition, CustomFieldType
from plane.utils.build_chart import build_leads_wins_by_field

# State groups that count as "closed" for win-rate purposes.
CLOSED_GROUPS = ["completed", "cancelled"]
WON_GROUP = "completed"
LOST_GROUP = "cancelled"


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

        # Handlers that return a plain payload.
        dispatch = {
            "win-rate": self.win_rate,
            "funnel": self.stage_distribution,
            "time-to-close": self.time_to_close,
            "trend": self.trend,
        }
        handler = dispatch.get(insight_type)
        if handler is None:
            return Response({"error": "Invalid or missing `type`"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(handler(), status=status.HTTP_200_OK)
