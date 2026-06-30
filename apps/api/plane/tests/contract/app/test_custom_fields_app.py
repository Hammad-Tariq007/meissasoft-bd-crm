# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, State


@pytest.fixture
def project(db, workspace, create_user):
    """A project with the test user as an active admin member."""
    project = Project.objects.create(
        name="CF Test Project",
        identifier="CFT",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(
        project=project, workspace=workspace, member=create_user, role=20, is_active=True
    )
    return project


@pytest.fixture
def work_item(db, project, workspace, create_user):
    """A work item to attach custom field values to."""
    state = State.objects.create(
        project=project,
        workspace=workspace,
        name="CF Test State",
        group="unstarted",
        color="#60646C",
        default=True,
    )
    return Issue.objects.create(
        project=project,
        workspace=workspace,
        name="CF work item",
        state=state,
        created_by=create_user,
    )


@pytest.mark.contract
@pytest.mark.django_db
def test_custom_field_value_set_and_list(session_client, workspace, project, work_item):
    """define a single_select (+option) and a text field, set both on a work item, list them back."""
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}"

    # (1) single_select field "Country" + one option
    response = session_client.post(
        f"{base}/custom-fields/",
        {"name": "Country", "field_type": "single_select"},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    country_id = response.json()["id"]

    response = session_client.post(
        f"{base}/custom-fields/{country_id}/options/",
        {"name": "Pakistan"},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    option_id = response.json()["id"]

    # (2) text field "Client Name"
    response = session_client.post(
        f"{base}/custom-fields/",
        {"name": "Client Name", "field_type": "text"},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    client_name_id = response.json()["id"]

    # (3) set both values on the work item
    values_url = f"{base}/issues/{work_item.id}/custom-field-values/"

    response = session_client.post(values_url, {"field": country_id, "value": option_id}, format="json")
    assert response.status_code == status.HTTP_200_OK

    response = session_client.post(
        values_url, {"field": client_name_id, "value": "Acme Corporation"}, format="json"
    )
    assert response.status_code == status.HTTP_200_OK

    # (4) list values and assert each comes back correct
    response = session_client.get(values_url, format="json")
    assert response.status_code == status.HTTP_200_OK

    values_by_field = {value["field"]: value for value in response.json()}
    assert len(values_by_field) == 2

    country_value = values_by_field[country_id]
    assert country_value["field_type"] == "single_select"
    assert country_value["value"] == option_id
    assert country_value["value_option"] == option_id

    client_name_value = values_by_field[client_name_id]
    assert client_name_value["field_type"] == "text"
    assert client_name_value["value"] == "Acme Corporation"
    assert client_name_value["value_text"] == "Acme Corporation"
