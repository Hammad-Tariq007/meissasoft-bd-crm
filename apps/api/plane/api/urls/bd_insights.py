# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views import (
    BDInsightsAPIEndpoint,
    BDInsightsMetadataAPIEndpoint,
    BDLeadsAPIEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/bd-insights/",
        BDInsightsAPIEndpoint.as_view(http_method_names=["get"]),
        name="bd-insights",
    ),
    path(
        "workspaces/<str:slug>/bd-insights/metadata/",
        BDInsightsMetadataAPIEndpoint.as_view(http_method_names=["get"]),
        name="bd-insights-metadata",
    ),
    path(
        "workspaces/<str:slug>/bd-insights/leads/",
        BDLeadsAPIEndpoint.as_view(http_method_names=["get"]),
        name="bd-insights-leads",
    ),
]
