# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    WebPushSubscriptionEndpoint,
    WebPushVAPIDKeyEndpoint,
)

urlpatterns = [
    path(
        "users/me/web-push/subscriptions/",
        WebPushSubscriptionEndpoint.as_view(),
        name="web-push-subscriptions",
    ),
    path(
        "users/me/web-push/subscriptions/<uuid:pk>/",
        WebPushSubscriptionEndpoint.as_view(),
        name="web-push-subscription",
    ),
    path(
        "users/me/web-push/vapid-key/",
        WebPushVAPIDKeyEndpoint.as_view(),
        name="web-push-vapid-key",
    ),
]
