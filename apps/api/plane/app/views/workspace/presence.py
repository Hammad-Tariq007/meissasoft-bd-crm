# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Workspace
from plane.utils.presence import (
    HEARTBEAT_INTERVAL,
    POLL_INTERVAL,
    PRESENCE_TTL,
    get_workspace_presence,
    record_heartbeat,
)


class PresenceHeartbeatThrottle(UserRateThrottle):
    """Guardrail against a buggy/abusive client flooding Redis with heartbeats.

    Normal use is ~1.3 beats/min/tab plus occasional activity/visibility bursts;
    120/min per user leaves comfortable headroom for many tabs while hard-capping
    a runaway loop.
    """

    scope = "presence_heartbeat"
    rate = "120/minute"


class WorkspacePresenceHeartbeatEndpoint(BaseAPIView):
    throttle_classes = [PresenceHeartbeatThrottle]

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        session_id = request.data.get("session_id")
        if not session_id:
            return Response(
                {"error": "session_id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace_id = Workspace.objects.values_list("id", flat=True).get(slug=slug)
        record_heartbeat(
            workspace_id=workspace_id,
            user_id=request.user.id,
            session_id=str(session_id),
            idle=bool(request.data.get("idle", False)),
            manual_status=request.data.get("manual_status"),
        )
        return Response(
            {
                "heartbeat_interval": HEARTBEAT_INTERVAL,
                "poll_interval": POLL_INTERVAL,
                "ttl": PRESENCE_TTL,
            },
            status=status.HTTP_200_OK,
        )


class WorkspacePresenceEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace_id = Workspace.objects.values_list("id", flat=True).get(slug=slug)
        # {user_id: "online" | "away" | "dnd"}; offline users are omitted.
        return Response(
            {"statuses": get_workspace_presence(workspace_id)},
            status=status.HTTP_200_OK,
        )
