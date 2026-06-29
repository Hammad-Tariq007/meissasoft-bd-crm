# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.serializers import WebPushSubscriptionSerializer
from plane.db.models import WebPushSubscription
from ..base import BaseAPIView


class WebPushSubscriptionEndpoint(BaseAPIView):
    serializer_class = WebPushSubscriptionSerializer

    def post(self, request):
        endpoint = request.data.get("endpoint")
        keys = request.data.get("keys") or {}
        p256dh = keys.get("p256dh") or request.data.get("p256dh")
        auth = keys.get("auth") or request.data.get("auth")

        if not (endpoint and p256dh and auth):
            return Response(
                {"error": "endpoint, p256dh and auth are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subscription, _ = WebPushSubscription.objects.update_or_create(
            user=request.user,
            endpoint=endpoint,
            defaults={"p256dh": p256dh, "auth": auth},
        )
        serializer = WebPushSubscriptionSerializer(subscription)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def delete(self, request, pk=None):
        subscriptions = WebPushSubscription.objects.filter(user=request.user)
        if pk:
            subscriptions = subscriptions.filter(pk=pk)
        else:
            endpoint = request.data.get("endpoint")
            if not endpoint:
                return Response(
                    {"error": "endpoint is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            subscriptions = subscriptions.filter(endpoint=endpoint)

        # hard delete so the same endpoint can be re-subscribed later
        subscriptions.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WebPushVAPIDKeyEndpoint(BaseAPIView):
    def get(self, request):
        return Response(
            {"vapid_public_key": settings.VAPID_PUBLIC_KEY},
            status=status.HTTP_200_OK,
        )
