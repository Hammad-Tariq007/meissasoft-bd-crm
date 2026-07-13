# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
BD Insights analytics endpoint (session-authenticated app API).

Powers the BD Insights slide-over widgets. ALL aggregation, field validation and
`type` routing live in the shared, framework-agnostic plane.utils.bd_insights_core
module — this view only builds the scoped queryset (via AdvanceAnalyticsBaseView's
filters), enforces the owner/admin permission gate, and wraps the result in a
Response. The token-authenticated public endpoint (plane.api.views.bd_insights)
reuses the exact same core, so both surfaces return identical results.
"""

from django.http import HttpRequest
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.analytic.advance import AdvanceAnalyticsBaseView
from plane.utils import bd_insights_core as core


class BDInsightsEndpoint(AdvanceAnalyticsBaseView):
    """Admin-only. `type` selects the widget aggregation; all math is in bd_insights_core."""

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def get(self, request: HttpRequest, slug: str) -> Response:
        # Authoritative gate: workspace admin (decorator) AND (owner OR can_view_analytics).
        if not core.has_analytics_access(request.user, slug):
            return Response(
                {"error": "You do not have analytics access for this workspace."},
                status=status.HTTP_403_FORBIDDEN,
            )
        self.initialize_workspace(slug, type="chart")
        queryset = core.scoped_issue_queryset(self.filters["base_filters"], self.filters["chart_period_range"])
        status_code, payload = core.dispatch_insight(
            request.GET.get("type", None),
            queryset,
            self.filters["base_filters"],
            self.filters["chart_period_range"],
            self._workspace_slug,
            request.GET.get("project_ids", None),
            request.GET.get,
        )
        return Response(payload, status=status_code)
