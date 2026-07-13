# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db.models import Q

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

        device_id = request.data.get("device_id")

        if not (endpoint and p256dh and auth):
            return Response(
                {"error": "endpoint, p256dh and auth are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if device_id:
            # One subscription per (user, browser): the browser's push endpoint can rotate
            # (VAPID change / re-subscribe), which previously left orphaned rows behind and
            # caused the same notification to be delivered — and pop — multiple times. Keying
            # on the stable device_id updates the same row instead of accumulating new ones.
            # Also drop this browser's legacy rows (pre-device_id and any stale endpoints) so
            # existing duplicates self-heal on the next subscribe.
            WebPushSubscription.objects.filter(user=request.user).filter(
                Q(device_id=device_id) | Q(device_id__isnull=True) | Q(endpoint=endpoint)
            ).delete(soft=False)
            subscription = WebPushSubscription.objects.create(
                user=request.user, endpoint=endpoint, p256dh=p256dh, auth=auth, device_id=device_id
            )
        else:
            # Legacy client without a device_id — fall back to endpoint-keyed upsert.
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
