# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    CustomFieldDefinitionViewSet,
    CustomFieldOptionViewSet,
    CustomFieldValueViewSet,
    ProjectCustomFieldValuesEndpoint,
)

urlpatterns = [
    # Field definitions (project-scoped CRUD)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-fields/",
        CustomFieldDefinitionViewSet.as_view({"get": "list", "post": "create"}),
        name="project-custom-fields",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-fields/<uuid:pk>/",
        CustomFieldDefinitionViewSet.as_view(
            {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
        ),
        name="project-custom-field",
    ),
    # Options of a select field (nested under a definition)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-fields/<uuid:field_id>/options/",
        CustomFieldOptionViewSet.as_view({"get": "list", "post": "create"}),
        name="custom-field-options",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-fields/<uuid:field_id>/options/reorder/",
        CustomFieldOptionViewSet.as_view({"post": "reorder"}),
        name="custom-field-options-reorder",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-fields/<uuid:field_id>/options/<uuid:pk>/",
        CustomFieldOptionViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="custom-field-option",
    ),
    # Bulk read of values across many work items (spreadsheet view)
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/custom-field-values/",
        ProjectCustomFieldValuesEndpoint.as_view(),
        name="project-custom-field-values",
    ),
    # Values for a given work item
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/custom-field-values/",
        CustomFieldValueViewSet.as_view({"get": "list", "post": "create"}),
        name="issue-custom-field-values",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/custom-field-values/<uuid:field_id>/",
        CustomFieldValueViewSet.as_view({"delete": "clear"}),
        name="issue-custom-field-value-clear",
    ),
]
