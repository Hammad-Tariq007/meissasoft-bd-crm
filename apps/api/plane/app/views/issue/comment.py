# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import Exists
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueCommentSerializer, CommentReactionSerializer
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import IssueComment, IssueCommentVisit, ProjectMember, CommentReaction, Project, Issue
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.host import base_host
from plane.bgtasks.webhook_task import model_activity


class IssueCommentViewSet(BaseViewSet):
    serializer_class = IssueCommentSerializer
    model = IssueComment
    webhook_event = "issue_comment"

    filterset_fields = ["issue__id", "workspace__id"]

    def get_queryset(self):
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project")
            .select_related("workspace")
            .select_related("issue")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        workspace__slug=self.kwargs.get("slug"),
                        project_id=self.kwargs.get("project_id"),
                        member_id=self.request.user.id,
                        is_active=True,
                    )
                )
            )
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, issue_id):
        project = Project.objects.get(pk=project_id)
        issue = Issue.objects.get(pk=issue_id)
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to comment on the issue"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = IssueCommentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(project_id=project_id, issue_id=issue_id, actor=request.user)
            issue_activity.delay(
                type="comment.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id")),
                project_id=str(self.kwargs.get("project_id")),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(serializer.data["id"]),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def partial_update(self, request, slug, project_id, issue_id, pk):
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        serializer = IssueCommentSerializer(issue_comment, data=request.data, partial=True)
        if serializer.is_valid():
            if "comment_html" in request.data and request.data["comment_html"] != issue_comment.comment_html:
                serializer.save(edited_at=timezone.now())
            else:
                serializer.save()
            issue_activity.delay(
                type="comment.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(pk),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=IssueComment)
    def destroy(self, request, slug, project_id, issue_id, pk):
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        issue_comment.delete()
        issue_activity.delay(
            type="comment.activity.deleted",
            requested_data=json.dumps({"comment_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def mark_viewed(self, request, slug, project_id, issue_id):
        """Record that the requesting user has viewed this work item's comment thread.
        Fired by the client (debounced) when the thread becomes visible / new comments
        arrive — this is the read signal behind comment read-receipts (Info). Idempotent
        upsert; a short server-side throttle guards against write-amplification."""
        now = timezone.now()
        workspace_id = Project.objects.values_list("workspace_id", flat=True).get(pk=project_id)
        existing = IssueCommentVisit.objects.filter(issue_id=issue_id, user=request.user).first()
        if existing and existing.viewed_at and (now - existing.viewed_at).total_seconds() < 10:
            return Response(status=status.HTTP_204_NO_CONTENT)  # updated a moment ago -> skip write
        IssueCommentVisit.objects.update_or_create(
            issue_id=issue_id,
            user=request.user,
            defaults={"viewed_at": now, "project_id": project_id, "workspace_id": workspace_id},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def info(self, request, slug, project_id, issue_id, pk):
        """Read-receipts for a single comment: which members have seen it and when.
        AUTHOR-ONLY and enforced here (not just in the UI) — a non-author gets 403.
        'Seen' = the member viewed this work item's comment thread at/after the comment
        was posted (viewed_at >= comment.created_at)."""
        comment = IssueComment.objects.filter(
            workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk
        ).first()
        if comment is None:
            return Response({"error": "Comment not found"}, status=status.HTTP_404_NOT_FOUND)
        if comment.actor_id != request.user.id:
            return Response(
                {"error": "You can only view info for your own comments."},
                status=status.HTTP_403_FORBIDDEN,
            )
        visits = (
            IssueCommentVisit.objects.filter(issue_id=issue_id, viewed_at__gte=comment.created_at)
            .exclude(user_id=comment.actor_id)
            .values("user_id", "viewed_at")
            .order_by("-viewed_at")
        )
        seen_by = [{"member_id": str(v["user_id"]), "seen_at": v["viewed_at"]} for v in visits]
        return Response({"total": len(seen_by), "seen_by": seen_by}, status=status.HTTP_200_OK)


class CommentReactionViewSet(BaseViewSet):
    serializer_class = CommentReactionSerializer
    model = CommentReaction

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(comment_id=self.kwargs.get("comment_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .order_by("-created_at")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def create(self, request, slug, project_id, comment_id):
        try:
            serializer = CommentReactionSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(
                    project_id=project_id,
                    actor_id=request.user.id,
                    comment_id=comment_id,
                )
                issue_activity.delay(
                    type="comment_reaction.activity.created",
                    requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                    actor_id=str(request.user.id),
                    issue_id=None,
                    project_id=str(project_id),
                    current_instance=None,
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "Reaction already exists for the user"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def destroy(self, request, slug, project_id, comment_id, reaction_code):
        comment_reaction = CommentReaction.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            comment_id=comment_id,
            reaction=reaction_code,
            actor=request.user,
        )
        issue_activity.delay(
            type="comment_reaction.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=json.dumps(
                {
                    "reaction": str(reaction_code),
                    "identifier": str(comment_reaction.id),
                    "comment_id": str(comment_id),
                }
            ),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        comment_reaction.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
