# BD CRM Phase 3 — per-profile lead VISIBILITY (project-scoped).
#
# THE ONE PLACE the visibility rule lives. Every path that returns Issue (lead) data to a
# user must route its queryset through here. A restricted BD (team="bd", not owner/admin/
# BD-lead) sees ONLY leads whose Profile custom-field value is one of the profiles assigned
# to them IN THAT PROJECT. Everyone else (owner / workspace-or-project admin / BD lead /
# non-BD) is unaffected — the helpers are a no-op for them.
#
# Fail-closed: a restricted BD for whom the Profile field can't be resolved, or who has no
# assignments in the project, sees NOTHING (never everything). No caching — visibility is
# derived live from current assignments + the lead's Profile value, so reassignment reflects
# on the next request and a newly-granted profile immediately exposes its full history.

from django.db.models import Exists, OuterRef, Q

from plane.db.models.bd_team import ProfileAssignment
from plane.db.models.custom_field import CustomFieldValue
from plane.utils import bd_insights_core as bd_core

# Sentinel meaning "match no rows" — used for fail-closed.
_NONE_Q = Q(pk__in=[])


def _profile_match_q(profile_field_id, assigned_option_ids):
    """A Q matching issues whose active Profile value is in the assigned set (via EXISTS —
    no join/duplicates, so no .distinct() needed)."""
    sub = CustomFieldValue.objects.filter(
        issue_id=OuterRef("pk"),
        field_id=profile_field_id,
        value_option_id__in=list(assigned_option_ids),
        deleted_at__isnull=True,
    )
    return Q(Exists(sub))


def restricted_issue_q(user, workspace_slug, project_id):
    """The Q a restricted BD's visible issues must satisfy for one project, or None if the
    user is NOT restricted (caller must not filter). Fail-closed for restricted BDs."""
    if not bd_core.is_restricted_bd(user, workspace_slug):
        return None
    field_id = bd_core.resolve_profile_field_id(workspace_slug, project_id)
    if field_id is None:
        return _NONE_Q  # Profile field unresolved (e.g. renamed) -> see nothing.
    assigned = bd_core.assigned_profile_option_ids(user, workspace_slug, project_id)
    if not assigned:
        return _NONE_Q  # No assignments in this project -> see nothing.
    return _profile_match_q(field_id, assigned)


def scope_project_issues(queryset, user, workspace_slug, project_id):
    """Restrict a single-project issue queryset to what the acting user may see. No-op for
    non-restricted users."""
    q = restricted_issue_q(user, workspace_slug, project_id)
    return queryset if q is None else queryset.filter(q)


def scope_workspace_issues(queryset, user, workspace_slug):
    """Restrict a CROSS-PROJECT issue queryset. A restricted BD sees only leads in projects
    where they hold a matching profile assignment; every other project is excluded. No-op
    for non-restricted users."""
    if not bd_core.is_restricted_bd(user, workspace_slug):
        return queryset
    project_ids = set(
        ProfileAssignment.objects.filter(
            bd_member__workspace__slug=workspace_slug,
            bd_member__member=user,
            bd_member__is_active=True,
        ).values_list("project_id", flat=True)
    )
    if not project_ids:
        return queryset.none()  # Restricted BD with no assignments anywhere -> nothing.
    combined = Q()
    for project_id in project_ids:
        # Per-project: correct Profile field + assigned set (fail-closed per project).
        combined |= Q(project_id=project_id) & restricted_issue_q(user, workspace_slug, project_id)
    return queryset.filter(combined)


def filter_issue_entity_rows(queryset, user, workspace_slug, entity_field="entity_name", issue_value="issue"):
    """Filter a queryset of rows that reference an entity by (kind, entity_identifier) — e.g.
    notifications, recent visits, favorites — so a restricted BD never sees a row pointing to
    a lead they may not see. Rows for the issue kind (`entity_field == issue_value`) are kept
    only when `entity_identifier` is a currently-visible lead; every other kind passes through.

    No-op for non-restricted users (owners, admins, BD *leads* — whose Phase-3 visibility is
    unrestricted — and non-BD members). Strict: involvement does not override the profile rule.

    `entity_field` names the kind column: "entity_name" (notifications, recent visits) or
    "entity_type" (favorites)."""
    if not bd_core.is_restricted_bd(user, workspace_slug):
        return queryset
    from plane.db.models import Issue

    visible = scope_workspace_issues(Issue.objects.filter(workspace__slug=workspace_slug), user, workspace_slug)
    return queryset.filter(
        ~Q(**{entity_field: issue_value}) | Q(entity_identifier__in=visible.values("id"))
    )


def filter_issue_notifications(notification_qs, user, workspace_slug):
    """Drop issue notifications that point to a lead the acting user may not see. Thin wrapper
    over filter_issue_entity_rows (notifications key the kind on `entity_name`)."""
    return filter_issue_entity_rows(notification_qs, user, workspace_slug, entity_field="entity_name")


def scope_intake_issues(intake_qs, user, workspace_slug, project_id):
    """Restrict an IntakeIssue queryset to intake rows whose underlying lead is visible.
    No-op for non-restricted users. (Triage leads usually lack a Profile, so a restricted
    BD sees only intake leads whose Profile is assigned to them.)"""
    q = restricted_issue_q(user, workspace_slug, project_id)
    if q is None:
        return intake_qs
    from plane.db.models import Issue

    visible = Issue.objects.filter(q, project_id=project_id)
    return intake_qs.filter(issue_id__in=visible.values("id"))


def is_issue_visible(user, workspace_slug, project_id, issue_id) -> bool:
    """Whether a specific lead is visible to the acting user — for detail/deep-link paths
    that should 404 (not 403) when hidden. No-op True for non-restricted users."""
    from plane.db.models import Issue

    q = restricted_issue_q(user, workspace_slug, project_id)
    if q is None:
        return True
    return Issue.objects.filter(q, pk=issue_id).exists()
