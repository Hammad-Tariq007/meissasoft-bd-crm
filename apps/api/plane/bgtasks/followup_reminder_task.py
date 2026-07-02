# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from datetime import timedelta

# Django imports
from django.conf import settings
from django.core.cache import cache
from django.db.models import DateTimeField, OuterRef, Subquery
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import Issue, IssueAssignee, IssueComment, WebPushSubscription
from plane.bgtasks.webpush_task import send_web_push
from plane.utils.exception_logger import log_exception

# A lead in one of these state groups is closed; everything else is an "open" lead.
# Resolved by state *group* (not name) so renaming states can't break it.
CLOSED_STATE_GROUPS = ["completed", "cancelled"]

# Marker lives a little over a day: long enough that a lead nudged today isn't
# nudged again today, short enough that it re-nudges tomorrow while still stale.
_MARKER_TTL_SECONDS = 60 * 60 * 26


@shared_task
def send_followup_reminders():
    """Web-push a follow-up nudge for open leads that have gone stale.

    A lead's last-activity timestamp is the most recent of its own ``updated_at``
    and its latest (non-deleted) comment's ``created_at`` — so an active comment
    thread keeps a lead "fresh" even when no field changed. A lead is stale when
    its state group is not completed/cancelled AND that last-activity timestamp is
    older than REMINDER_DAYS. Each stale lead nudges its assignee(s) plus a
    configured admin, at most once per lead per day. Reuses the native
    send_web_push task — no push logic is duplicated here. Runs daily from Beat.
    """
    if not settings.REMINDER_ENABLED:
        print("[FOLLOWUP] REMINDER_ENABLED is off — skipping")
        return

    days = settings.REMINDER_DAYS
    threshold = timezone.now() - timedelta(days=days)
    admin_user_id = str(settings.FOLLOWUP_ADMIN_USER_ID) if settings.FOLLOWUP_ADMIN_USER_ID else None

    # Latest comment time per lead, as a correlated subquery (one SQL statement,
    # no per-lead query and no join fan-out). Honors soft-deleted comments.
    latest_comment_at = (
        IssueComment.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
        .order_by("-created_at")
        .values("created_at")[:1]
    )

    # Open, stale leads. issue_objects already excludes triage/archived/draft/deleted.
    leads = list(
        Issue.issue_objects.exclude(state__group__in=CLOSED_STATE_GROUPS)
        .annotate(last_comment_at=Subquery(latest_comment_at, output_field=DateTimeField()))
        .annotate(last_activity_at=Greatest("updated_at", Coalesce("last_comment_at", "updated_at")))
        .filter(last_activity_at__lt=threshold)
        .select_related("project", "project__workspace")
    )
    if not leads:
        print("[FOLLOWUP] no stale leads")
        return

    lead_ids = [lead.id for lead in leads]

    # assignee ids per lead — one query, honoring soft-deleted assignments.
    assignees_by_lead = {}
    for issue_id, assignee_id in IssueAssignee.objects.filter(
        issue_id__in=lead_ids, deleted_at__isnull=True
    ).values_list("issue_id", "assignee_id"):
        assignees_by_lead.setdefault(issue_id, set()).add(str(assignee_id))

    # Only queue for users who actually have a push subscription — one query.
    subscribed = {
        str(uid) for uid in WebPushSubscription.objects.values_list("user_id", flat=True).distinct()
    }

    today = timezone.now().date().isoformat()
    queued = 0

    for issue in leads:
        try:
            recipients = set(assignees_by_lead.get(issue.id, set()))
            if admin_user_id:
                recipients.add(admin_user_id)  # de-duped if admin is also the assignee

            targets = recipients & subscribed
            if not targets:
                continue  # nobody reachable — don't consume today's marker

            # Once-per-lead-per-day guard. cache.add is an atomic set-if-absent,
            # so a duplicate/overlapping run can't double-nudge the same lead today.
            marker_key = f"followup_reminder:{issue.id}:{today}"
            if not cache.add(marker_key, 1, timeout=_MARKER_TTL_SECONDS):
                continue

            stale_days = max((timezone.now() - issue.last_activity_at).days, days)
            project = issue.project
            identifier = f"{project.identifier}-{issue.sequence_id}"
            url = (
                f"{settings.WEB_URL}/{project.workspace.slug}/projects/{project.id}/issues/{issue.id}"
                if settings.WEB_URL
                else None
            )
            payload = {
                "title": f"Follow-up: {identifier} {issue.name}",
                "body": f"No activity for {stale_days} days",
                "tag": f"followup-{issue.id}",  # collapse repeats for the same lead
                "badge": "/icons/icon-192x192.png",
                "icon": "/icons/icon-192x192.png",
                "url": url,
                "issueId": str(issue.id),
                "projectId": str(project.id),
                "workspaceSlug": project.workspace.slug,
                "issueIdentifier": identifier,
            }

            for user_id in targets:
                send_web_push.delay(user_id, payload)
                queued += 1
        except Exception as e:
            log_exception(e)

    print(f"[FOLLOWUP] queued {queued} push(es) across {len(leads)} stale lead(s) (>{days}d)")
    return
