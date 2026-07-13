# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from django.db import models

from .base import BaseModel


class WebPushSubscription(BaseModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="web_push_subscriptions",
    )
    endpoint = models.CharField(max_length=1024)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    # Stable per-browser identifier (client-generated, persisted in localStorage). Lets us
    # keep exactly ONE subscription per browser: when a browser's push endpoint rotates
    # (VAPID change / re-subscribe), we update the same row instead of orphaning the old
    # one — orphaned rows are why a single notification was delivered (and popped) twice.
    device_id = models.CharField(max_length=64, null=True, blank=True)

    class Meta:
        unique_together = ("user", "endpoint")
        db_table = "web_push_subscriptions"
        verbose_name = "Web Push Subscription"
        verbose_name_plural = "Web Push Subscriptions"

    def __str__(self):
        return f"{self.user_id} <{self.endpoint}>"
