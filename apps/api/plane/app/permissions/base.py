# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import WorkspaceMember, ProjectMember, IssueAssignee
from functools import wraps
from rest_framework.response import Response
from rest_framework import status

from enum import Enum


class ROLE(Enum):
    ADMIN = 20
    MEMBER = 15
    GUEST = 5


def is_project_admin(user, slug, project_id):
    """A project admin, or a workspace admin who belongs to the project."""
    if ProjectMember.objects.filter(
        member=user,
        workspace__slug=slug,
        project_id=project_id,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).exists():
        return True
    return (
        ProjectMember.objects.filter(
            member=user, workspace__slug=slug, project_id=project_id, is_active=True
        ).exists()
        and WorkspaceMember.objects.filter(
            member=user, workspace__slug=slug, role=ROLE.ADMIN.value, is_active=True
        ).exists()
    )


def is_issue_assignee(user, issue_id):
    """True if the user is currently assigned to the given work item (lead)."""
    if not issue_id:
        return False
    return IssueAssignee.objects.filter(
        issue_id=issue_id, assignee=user, deleted_at__isnull=True
    ).exists()


def can_bd_edit_lead(user, slug, project_id, issue_id):
    """BD-CRM edit ownership, layered ON TOP of the normal admin/assignee gate.

    - A BD *team lead* (team=bd, is_team_lead) may edit ANY lead in the workspace, mirroring
      their unrestricted Phase-3 read visibility.
    - A *restricted* BD may edit a lead whose Profile is assigned to them, mirroring their
      Phase-3 read visibility (is_issue_visible is the exact profile-scope check, fail-closed).

    Returns False for everyone else (non-BD members, admins, owners), so the caller's existing
    admin/assignee rules are left completely unchanged — this only ever ADDS access. Lazy
    imports avoid an import cycle between the permissions and plane.utils layers.
    """
    if not issue_id:
        return False
    from plane.utils import bd_insights_core as bd_core
    from plane.utils import bd_visibility as bd_vis

    if not bd_core.is_bd(user, slug):
        return False
    if bd_core.is_team_lead(user, slug):
        return True  # BD lead: edit any lead in the workspace.
    if bd_core.is_restricted_bd(user, slug):
        return bd_vis.is_issue_visible(user, slug, project_id, issue_id)
    return False


def can_edit_all_issues(user, slug, project_id, issue_ids):
    """
    True if the user may edit every work item in issue_ids — i.e. they are a
    project admin, or the assignee of each one (or, per BD-CRM, a BD lead / the
    profile-owning restricted BD of each). Used by list-body endpoints (cycle/module
    assignment) that the per-request assignee decorator can't cover.
    """
    if is_project_admin(user, slug, project_id):
        return True
    if not issue_ids:
        return True
    assigned = set(
        str(i)
        for i in IssueAssignee.objects.filter(
            issue_id__in=issue_ids, assignee=user, deleted_at__isnull=True
        ).values_list("issue_id", flat=True)
    )
    return all(
        str(i) in assigned or can_bd_edit_lead(user, slug, project_id, i) for i in issue_ids
    )


def allow_permission(allowed_roles, level="PROJECT", creator=False, model=None, assignee=False):
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            # Check for creator if required
            if creator and model:
                # check if the user is part of the workspace or not
                if not WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    is_active=True,
                ).exists():
                    return Response(
                        {"error": "You don't have the required permissions."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                obj = model.objects.filter(id=kwargs["pk"], created_by=request.user).exists()
                if obj:
                    return view_func(instance, request, *args, **kwargs)

            # Check for the work item assignee (lead owner) if required. The
            # issue id lives in `pk` on the issue detail routes and in `issue_id`
            # on sub-resource routes (custom fields, links, ...). This lets the
            # assigned BD through; admins still pass via the role check below.
            if assignee:
                issue_id = kwargs.get("pk") or kwargs.get("issue_id")
                if (
                    issue_id
                    and WorkspaceMember.objects.filter(
                        member=request.user,
                        workspace__slug=kwargs["slug"],
                        is_active=True,
                    ).exists()
                    and (
                        is_issue_assignee(request.user, issue_id)
                        or can_bd_edit_lead(request.user, kwargs["slug"], kwargs.get("project_id"), issue_id)
                    )
                ):
                    return view_func(instance, request, *args, **kwargs)

            # Convert allowed_roles to their values if they are enum members
            allowed_role_values = [role.value if isinstance(role, ROLE) else role for role in allowed_roles]

            # Check role permissions
            if level == "WORKSPACE":
                if WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    role__in=allowed_role_values,
                    is_active=True,
                ).exists():
                    return view_func(instance, request, *args, **kwargs)
            else:
                is_user_has_allowed_role = ProjectMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    project_id=kwargs["project_id"],
                    role__in=allowed_role_values,
                    is_active=True,
                ).exists()

                # Return if the user has the allowed role else if they are workspace admin and part of the project regardless of the role # noqa: E501
                if is_user_has_allowed_role:
                    return view_func(instance, request, *args, **kwargs)
                elif (
                    ProjectMember.objects.filter(
                        member=request.user,
                        workspace__slug=kwargs["slug"],
                        project_id=kwargs["project_id"],
                        is_active=True,
                    ).exists()
                    and WorkspaceMember.objects.filter(
                        member=request.user,
                        workspace__slug=kwargs["slug"],
                        role=ROLE.ADMIN.value,
                        is_active=True,
                    ).exists()
                ):
                    return view_func(instance, request, *args, **kwargs)

            # Return permission denied if no conditions are met
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return _wrapped_view

    return decorator
