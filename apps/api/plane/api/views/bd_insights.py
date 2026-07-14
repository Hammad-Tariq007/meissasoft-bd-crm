# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Public (token-authenticated) read-only BD Insights.

Mounted on the public API router (/api/v1/), authenticated with X-Api-Key like the
rest of /api/v1/. All three endpoints reuse the SAME aggregation/read core
(plane.utils.bd_insights_core) as the session app endpoint, and enforce the IDENTICAL
gate: workspace ADMIN AND (workspace owner OR can_view_analytics). A personal access
token therefore only returns data if its owning user passes that gate — otherwise 403.

  GET .../bd-insights/           -> analytics by ?type=
  GET .../bd-insights/metadata/  -> field name->id + options + states (filter values)
  GET .../bd-insights/leads/     -> paginated leads with key fields + BD custom fields
"""

from typing import Optional

from django.http import HttpRequest
from rest_framework import status
from rest_framework.response import Response

from plane.api.views.base import BaseAPIView
from plane.app.permissions import ROLE
from plane.db.models import WorkspaceMember
from plane.utils import bd_insights_core as core
from plane.utils.date_utils import get_analytics_filters


def _forbidden_if_no_access(user, slug: str) -> Optional[Response]:
    """Identical gate to the app endpoint: workspace admin AND (owner OR flag)."""
    is_admin = WorkspaceMember.objects.filter(
        workspace__slug=slug, member=user, is_active=True, role=ROLE.ADMIN.value
    ).exists()
    if not is_admin or not core.has_analytics_access(user, slug):
        return Response(
            {"error": "You do not have analytics access for this workspace."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def _project_ids(request: HttpRequest) -> Optional[str]:
    # Accept project_id (singular, external-friendly) or project_ids (csv, app-style).
    return request.GET.get("project_ids") or request.GET.get("project_id")


class BDInsightsAPIEndpoint(BaseAPIView):
    """GET /api/v1/workspaces/<slug>/bd-insights/?type=…&project_id=…&date_filter=…

    Read-only. `type` selects the aggregation (win-rate, funnel, conversion-funnel,
    time-to-close, trend, by-field, connects, economics-by-segment, boosted,
    cycle-by-field, velocity, forecast, loss-reasons) — identical to the app endpoint.
    """

    def get(self, request: HttpRequest, slug: str) -> Response:
        denied = _forbidden_if_no_access(request.user, slug)
        if denied:
            return denied

        project_ids = _project_ids(request)
        filters = get_analytics_filters(
            slug=slug,
            user=request.user,
            type="chart",
            date_filter=request.GET.get("date_filter"),
            start_date=request.GET.get("start_date"),
            end_date=request.GET.get("end_date"),
            project_ids=project_ids,
        )
        queryset = core.scoped_issue_queryset(filters["base_filters"], filters["chart_period_range"])
        status_code, payload = core.dispatch_insight(
            request.GET.get("type", None),
            queryset,
            filters["base_filters"],
            filters["chart_period_range"],
            slug,
            project_ids,
            request.GET.get,
        )
        return Response(payload, status=status_code)


class BDInsightsMetadataAPIEndpoint(BaseAPIView):
    """GET /api/v1/workspaces/<slug>/bd-insights/metadata/?project_id=…

    Custom-field definitions (name -> id/type/options) + states, so a client can resolve
    field names to ids and know the valid filter values (profiles/countries/etc.)."""

    def get(self, request: HttpRequest, slug: str) -> Response:
        denied = _forbidden_if_no_access(request.user, slug)
        if denied:
            return denied
        return Response(core.bd_metadata(slug, _project_ids(request)), status=status.HTTP_200_OK)


class BDLeadsAPIEndpoint(BaseAPIView):
    """GET /api/v1/workspaces/<slug>/bd-insights/leads/?project_id=…&state=&profile=&country=&limit=&offset=

    Paginated, read-only lead list with key fields + BD custom-field values. Date scope via
    date_filter / start_date / end_date, like the analytics endpoint."""

    def get(self, request: HttpRequest, slug: str) -> Response:
        denied = _forbidden_if_no_access(request.user, slug)
        if denied:
            return denied

        project_ids = _project_ids(request)
        filters = get_analytics_filters(
            slug=slug,
            user=request.user,
            type="chart",
            date_filter=request.GET.get("date_filter"),
            start_date=request.GET.get("start_date"),
            end_date=request.GET.get("end_date"),
            project_ids=project_ids,
        )
        queryset = core.scoped_issue_queryset(filters["base_filters"], filters["chart_period_range"])
        payload = core.list_leads(
            queryset,
            slug,
            project_ids,
            state=request.GET.get("state"),
            profile=request.GET.get("profile"),
            country=request.GET.get("country"),
            limit=request.GET.get("limit", 50),
            offset=request.GET.get("offset", 0),
        )
        return Response(payload, status=status.HTTP_200_OK)
