# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.conf import settings

# Third party imports
from celery import shared_task
from pywebpush import webpush, WebPushException

# Module imports
from plane.db.models import WebPushSubscription
from plane.utils.exception_logger import log_exception


@shared_task
def send_web_push(user_id, payload):
    """Send a web push notification to all of a user's stored subscriptions.

    ``payload`` is a dict (``title``/``body``/``url``) that is serialized and
    delivered to the browser's service worker. Subscriptions that the push
    service reports as gone (404/410) are deleted so we stop retrying them.
    """
    # Web push can only be sent when the server has VAPID keys configured
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return

    subscriptions = WebPushSubscription.objects.filter(user_id=user_id)
    data = json.dumps(payload)

    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {
                        "p256dh": subscription.p256dh,
                        "auth": subscription.auth,
                    },
                },
                data=data,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
        except WebPushException as e:
            # The endpoint is gone (unsubscribed/expired) - remove it
            status_code = e.response.status_code if e.response is not None else None
            if status_code in (404, 410):
                # hard delete so the same endpoint can be re-subscribed later
                subscription.delete(soft=False)
            else:
                log_exception(e)
        except Exception as e:
            log_exception(e)
    return
