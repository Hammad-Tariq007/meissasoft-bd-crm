# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import transaction
from django.db.models import Count, Q, OuterRef, Subquery, IntegerField
from django.utils import timezone
from django.db.models.functions import Coalesce

# Third party modules
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import WorkspaceEntityPermission, allow_permission, ROLE

# Module imports
from plane.app.serializers import (
    ProjectMemberRoleSerializer,
    WorkspaceMemberAdminSerializer,
    WorkspaceMemberMeSerializer,
    WorkSpaceMemberSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectMember, Workspace, WorkspaceMember, DraftIssue
from plane.db.models.workspace import WorkspaceTeam
from plane.db.models.custom_field import CustomFieldOption
from plane.db.models.bd_team import ProfileAssignment
from plane.utils import bd_insights_core as bd_core
from plane.utils.cache import invalidate_cache

from .. import BaseViewSet


class WorkSpaceMemberViewSet(BaseViewSet):
    serializer_class = WorkspaceMemberAdminSerializer
    model = WorkspaceMember

    search_fields = ["member__display_name", "member__first_name"]
    use_read_replica = True

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("member", "member__avatar_asset")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        # Get all active workspace members
        workspace_members = self.get_queryset()
        if workspace_member.role > 5:
            serializer = WorkspaceMemberAdminSerializer(
                workspace_members,
                fields=("id", "member", "role", "can_view_analytics", "team", "is_team_lead"),
                many=True,
            )
        else:
            serializer = WorkSpaceMemberSerializer(workspace_members, fields=("id", "member", "role"), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug, pk):
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        try:
            # Get the specific workspace member by pk
            member = self.get_queryset().get(pk=pk)
        except WorkspaceMember.DoesNotExist:
            return Response(
                {"error": "Workspace member not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if workspace_member.role > ROLE.GUEST.value:
            serializer = WorkspaceMemberAdminSerializer(
                member, fields=("id", "member", "role", "can_view_analytics", "team", "is_team_lead")
            )
        else:
            serializer = WorkSpaceMemberSerializer(member, fields=("id", "member", "role"))
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        workspace_member = WorkspaceMember.objects.get(
            pk=pk, workspace__slug=slug, member__is_bot=False, is_active=True
        )
        if request.user.id == workspace_member.member_id:
            return Response(
                {"error": "You cannot update your own role"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If a user is moved to a guest role he can't have any other role in projects
        if "role" in request.data and int(request.data.get("role")) == 5:
            ProjectMember.objects.filter(workspace__slug=slug, member_id=workspace_member.member_id).update(role=5)

        serializer = WorkSpaceMemberSerializer(workspace_member, data=request.data, partial=True)

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def set_analytics_access(self, request, slug, pk):
        """Grant/revoke a member's BD Insights analytics access. Owner-only —
        deliberately stricter than the ADMIN decorator: even other workspace
        admins get 403. `can_view_analytics` is an additive per-member flag, not
        a role."""
        if not Workspace.objects.filter(slug=slug, owner=request.user).exists():
            return Response(
                {"error": "Only the workspace owner can change analytics access."},
                status=status.HTTP_403_FORBIDDEN,
            )
        workspace_member = WorkspaceMember.objects.filter(
            pk=pk, workspace__slug=slug, member__is_bot=False, is_active=True
        ).first()
        if workspace_member is None:
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)

        value = request.data.get("can_view_analytics")
        if not isinstance(value, bool):
            return Response(
                {"error": "`can_view_analytics` (boolean) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        workspace_member.can_view_analytics = value
        workspace_member.save(update_fields=["can_view_analytics", "updated_at"])
        serializer = WorkspaceMemberAdminSerializer(
            workspace_member, fields=("id", "member", "role", "can_view_analytics")
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def set_team(self, request, slug, pk):
        """Set a member's team (BD/Dev/unassigned) and team-lead flag. Owner-only —
        like set_analytics_access, deliberately stricter than the ADMIN decorator.
        App-level rule (no DB constraint yet): a team has at most one lead."""
        if not Workspace.objects.filter(slug=slug, owner=request.user).exists():
            return Response(
                {"error": "Only the workspace owner can change team assignments."},
                status=status.HTTP_403_FORBIDDEN,
            )
        workspace_member = WorkspaceMember.objects.filter(
            pk=pk, workspace__slug=slug, member__is_bot=False, is_active=True
        ).first()
        if workspace_member is None:
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)

        # Fall back to the current value for whichever field is omitted.
        team = request.data.get("team", workspace_member.team)
        if team in ("", None):
            team = None
        is_lead = request.data.get("is_team_lead", workspace_member.is_team_lead)

        valid_teams = {choice.value for choice in WorkspaceTeam}
        if team is not None and team not in valid_teams:
            return Response(
                {"error": f"`team` must be one of {sorted(valid_teams)} or null."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(is_lead, bool):
            return Response(
                {"error": "`is_team_lead` (boolean) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_lead and team is None:
            return Response(
                {"error": "A team lead must belong to a team; set `team` first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # App-level enforcement: at most one lead per team (DB constraint deferred).
        if is_lead:
            clash = (
                WorkspaceMember.objects.filter(
                    workspace__slug=slug, team=team, is_team_lead=True, is_active=True
                )
                .exclude(pk=workspace_member.pk)
                .select_related("member")
                .first()
            )
            if clash is not None:
                return Response(
                    {"error": f"The {team} team already has a lead ({clash.member.email}). Demote them first."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        workspace_member.team = team
        workspace_member.is_team_lead = is_lead
        workspace_member.save(update_fields=["team", "is_team_lead", "updated_at"])
        serializer = WorkspaceMemberAdminSerializer(
            workspace_member,
            fields=("id", "member", "role", "can_view_analytics", "team", "is_team_lead"),
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    def _can_manage_profile_assignments(self, user, slug):
        """Profile-assignment managers: workspace OWNER, a workspace ADMIN, or the BD lead."""
        return (
            Workspace.objects.filter(slug=slug, owner=user).exists()
            or WorkspaceMember.objects.filter(
                workspace__slug=slug, member=user, is_active=True, role=ROLE.ADMIN.value
            ).exists()
            or bd_core.is_team_lead(user, slug, team=WorkspaceTeam.BD)
        )

    def _available_profile_options(self, slug):
        """All options of the 'Profile' field(s) in this workspace, for the picker."""
        return list(
            CustomFieldOption.objects.filter(
                field__name=bd_core.PROFILE_FIELD_NAME, field__workspace__slug=slug, is_active=True
            )
            .values("id", "name")
            .order_by("sequence", "name")
        )

    # The setter is gated to admin/member/guest at the decorator so a BD lead (a MEMBER)
    # can reach it; the precise owner/admin/BD-lead gate is enforced in the body.
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get_profiles(self, request, slug, pk):
        """A BD member's assigned Profile options + the available options. Manager-gated."""
        if not self._can_manage_profile_assignments(request.user, slug):
            return Response(
                {"error": "Only the workspace owner, an admin, or the BD lead can view profile assignments."},
                status=status.HTTP_403_FORBIDDEN,
            )
        target = WorkspaceMember.objects.filter(
            pk=pk, workspace__slug=slug, member__is_bot=False, is_active=True
        ).select_related("member").first()
        if target is None:
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)
        assigned = sorted(str(x) for x in bd_core.assigned_profile_option_ids(target.member, slug))
        return Response(
            {
                "member": str(target.member_id),
                "team": target.team,
                "profile_option_ids": assigned,
                "available": [{"id": str(o["id"]), "name": o["name"]} for o in self._available_profile_options(slug)],
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def set_profiles(self, request, slug, pk):
        """Replace a BD member's profile assignments. Manager-gated (owner/admin/BD-lead).
        Validates the target is a BD and every option belongs to the 'Profile' field."""
        if not self._can_manage_profile_assignments(request.user, slug):
            return Response(
                {"error": "Only the workspace owner, an admin, or the BD lead can manage profile assignments."},
                status=status.HTTP_403_FORBIDDEN,
            )
        target = WorkspaceMember.objects.filter(
            pk=pk, workspace__slug=slug, member__is_bot=False, is_active=True
        ).first()
        if target is None:
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)
        if target.team != WorkspaceTeam.BD:
            return Response(
                {"error": "Profiles can only be assigned to BD team members."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ids = request.data.get("profile_option_ids")
        if not isinstance(ids, list):
            return Response(
                {"error": "`profile_option_ids` (list) is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        requested = {str(x) for x in ids}
        # Every id must be an option of the 'Profile' field in this workspace (id-based).
        valid = {
            str(x)
            for x in CustomFieldOption.objects.filter(
                id__in=list(requested), field__name=bd_core.PROFILE_FIELD_NAME, field__workspace__slug=slug
            ).values_list("id", flat=True)
        }
        if requested - valid:
            return Response(
                {"error": "Some options are not valid Profile options."}, status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            ProfileAssignment.objects.filter(bd_member=target).delete(soft=False)
            ProfileAssignment.objects.bulk_create(
                [
                    ProfileAssignment(workspace=target.workspace, bd_member=target, profile_option_id=oid)
                    for oid in valid
                ]
            )
        return Response(
            {"member": str(target.member_id), "profile_option_ids": sorted(valid)}, status=status.HTTP_200_OK
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def my_profiles(self, request, slug):
        """The current user's own restriction state + assigned option ids (for the lead
        Profile dropdown filter). The backend enforcement is the real guard."""
        return Response(
            {
                "restricted": bd_core.is_restricted_bd(request.user, slug),
                "profile_option_ids": sorted(
                    str(x) for x in bd_core.assigned_profile_option_ids(request.user, slug)
                ),
                # Lets the Members UI decide whether to show the profile-assignment control.
                "can_manage_assignments": self._can_manage_profile_assignments(request.user, slug),
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        # Check the user role who is deleting the user
        workspace_member = WorkspaceMember.objects.get(
            workspace__slug=slug, pk=pk, member__is_bot=False, is_active=True
        )

        # check requesting user role
        requesting_workspace_member = WorkspaceMember.objects.get(
            workspace__slug=slug, member=request.user, is_active=True
        )

        if str(workspace_member.id) == str(requesting_workspace_member.id):
            return Response(
                {"error": "You cannot remove yourself from the workspace. Please use leave workspace"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if requesting_workspace_member.role < workspace_member.role:
            return Response(
                {"error": "You cannot remove a user having role higher than you"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            Project.objects.annotate(
                total_members=Count("project_projectmember"),
                member_with_role=Count(
                    "project_projectmember",
                    filter=Q(
                        project_projectmember__member_id=workspace_member.id,
                        project_projectmember__role=20,
                    ),
                ),
            )
            .filter(total_members=1, member_with_role=1, workspace__slug=slug)
            .exists()
        ):
            return Response(
                {
                    "error": "User is a part of some projects where they are the only admin, they should either leave that project or promote another user to admin."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Deactivate the users from the projects where the user is part of
        _ = ProjectMember.objects.filter(
            workspace__slug=slug, member_id=workspace_member.member_id, is_active=True
        ).update(is_active=False, updated_at=timezone.now())

        workspace_member.is_active = False
        workspace_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @invalidate_cache(
        path="/api/workspaces/:slug/members/",
        url_params=True,
        user=False,
        multiple=True,
    )
    @invalidate_cache(path="/api/users/me/settings/")
    @invalidate_cache(path="api/users/me/workspaces/", user=False, multiple=True)
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def leave(self, request, slug):
        workspace_member = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)

        # Check if the leaving user is the only admin of the workspace
        if (
            workspace_member.role == 20
            and not WorkspaceMember.objects.filter(workspace__slug=slug, role=20, is_active=True).count() > 1
        ):
            return Response(
                {
                    "error": "You cannot leave the workspace as you are the only admin of the workspace you will have to either delete the workspace or promote another user to admin."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            Project.objects.annotate(
                total_members=Count("project_projectmember"),
                member_with_role=Count(
                    "project_projectmember",
                    filter=Q(
                        project_projectmember__member_id=request.user.id,
                        project_projectmember__role=20,
                    ),
                ),
            )
            .filter(total_members=1, member_with_role=1, workspace__slug=slug)
            .exists()
        ):
            return Response(
                {
                    "error": "You are a part of some projects where you are the only admin, you should either leave the project or promote another user to admin."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # # Deactivate the users from the projects where the user is part of
        _ = ProjectMember.objects.filter(
            workspace__slug=slug, member_id=workspace_member.member_id, is_active=True
        ).update(is_active=False, updated_at=timezone.now())

        # # Deactivate the user
        workspace_member.is_active = False
        workspace_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceMemberUserViewsEndpoint(BaseAPIView):
    def post(self, request, slug):
        workspace_member = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)
        workspace_member.view_props = request.data.get("view_props", {})
        workspace_member.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceMemberUserEndpoint(BaseAPIView):
    use_read_replica = True

    def get(self, request, slug):
        draft_issue_count = (
            DraftIssue.objects.filter(created_by=request.user, workspace_id=OuterRef("workspace_id"))
            .values("workspace_id")
            .annotate(count=Count("id"))
            .values("count")
        )

        workspace_member = (
            WorkspaceMember.objects.filter(member=request.user, workspace__slug=slug, is_active=True)
            .annotate(draft_issue_count=Coalesce(Subquery(draft_issue_count, output_field=IntegerField()), 0))
            .first()
        )
        serializer = WorkspaceMemberMeSerializer(workspace_member)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkspaceProjectMemberEndpoint(BaseAPIView):
    serializer_class = ProjectMemberRoleSerializer
    model = ProjectMember

    permission_classes = [WorkspaceEntityPermission]

    def get(self, request, slug):
        # Fetch all project IDs where the user is involved
        project_ids = (
            ProjectMember.objects.filter(member=request.user, is_active=True)
            .values_list("project_id", flat=True)
            .distinct()
        )

        # Get all the project members in which the user is involved
        project_members = ProjectMember.objects.filter(
            workspace__slug=slug, project_id__in=project_ids, is_active=True
        ).select_related("project", "member", "workspace")
        project_members = ProjectMemberRoleSerializer(project_members, many=True).data

        project_members_dict = dict()

        # Construct a dictionary with project_id as key and project_members as value
        for project_member in project_members:
            project_id = project_member.pop("project")
            if str(project_id) not in project_members_dict:
                project_members_dict[str(project_id)] = []
            project_members_dict[str(project_id)].append(project_member)

        return Response(project_members_dict, status=status.HTTP_200_OK)
