# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from .workspace import (
    WorkSpaceBasePermission,
    WorkspaceOwnerPermission,
    WorkSpaceAdminPermission,
    WorkspaceEntityPermission,
    WorkspaceViewerPermission,
    WorkspaceUserPermission,
)
from .project import (
    ProjectBasePermission,
    ProjectEntityPermission,
    ProjectMemberPermission,
    ProjectLitePermission,
    ProjectAdminPermission,
    ProjectIssueEditPermission,
)
from .base import (
    allow_permission,
    ROLE,
    is_project_admin,
    is_issue_assignee,
    can_edit_all_issues,
    can_bd_edit_lead,
)
from .page import ProjectPagePermission
