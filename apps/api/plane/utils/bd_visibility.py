# BD CRM — TEAM-AWARE lead VISIBILITY (the one place the read rule lives).
#
# Every path that returns Issue (lead) data to a user routes its queryset through here. The
# restriction depends on the member's team (WorkspaceMember.team), classified by
# _restriction_kind():
#   - BD member (not an overseer)   -> sees ONLY leads whose Profile value is one of the
#                                      profiles assigned to them IN THAT PROJECT (project-scoped).
#   - Dev member (not an overseer)  -> sees ONLY leads where they are the "Assigned Dev"
#                                      (MEMBER custom field; matched by name -> cross-project).
#                                      NOTE: keyed on the dedicated "Assigned Dev" field, NOT
#                                      the native "BD"/Assignee (IssueAssignee), which is untouched.
#   - Unassigned member (no team)   -> sees NOTHING (fail-closed).
#   - Overseer (workspace owner / workspace admin / ANY team lead) or non-member
#                                    -> unrestricted, the helpers are a no-op.
#   - Project ADMIN (of a given project) -> a PROJECT-SCOPED overseer: sees EVERY lead in the
#                                      project(s) they administer, regardless of team scope, while
#                                      staying team-scoped in projects they don't administer (so
#                                      no cross-project leak). Layered on top of the team rule.
#
# EDIT / profile-write logic does NOT route through here — it keeps using bd_core.is_restricted_bd
# (BD-specific), unchanged.
#
# Fail-closed everywhere: a restricted member whose scope can't be resolved sees NOTHING (never
# everything). No caching — visibility is derived live from current assignments (profile options
# or Assigned-Dev field values), so a reassignment reflects on the very next request.

from django.db.models import Exists, OuterRef, Q

from plane.db.models.bd_team import ProfileAssignment
from plane.db.models.custom_field import CustomFieldValue
from plane.db.models.project import ProjectMember, ROLE
from plane.db.models.workspace import Workspace, WorkspaceMember, WorkspaceTeam
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


def _assigned_dev_match_q(user):
    """A Q matching leads where the user is the 'Assigned Dev' — the MEMBER custom field whose
    value_member points at a Dev — via EXISTS (no join/duplicates). Drives the Dev team's
    read-visibility. Matched by field NAME, so it is naturally cross-project AND fail-closed:
    if the field is renamed/absent, nothing matches (a Dev sees NOTHING), never everything.
    Deliberately independent of the native "BD"/Assignee (IssueAssignee), which is untouched."""
    sub = CustomFieldValue.objects.filter(
        issue_id=OuterRef("pk"),
        field__name=bd_core.ASSIGNED_DEV_FIELD_NAME,
        value_member=user,
        deleted_at__isnull=True,
    )
    return Q(Exists(sub))


# Read-restriction kinds returned by _restriction_kind(). None => unrestricted.
_KIND_BD = "bd"  # BD team, not an overseer -> profile-scoped
_KIND_DEV = "dev"  # Dev team, not an overseer -> Assigned-Dev-scoped
_KIND_UNASSIGNED = "unassigned"  # active member, no team -> sees NOTHING (Option B, fail-closed)


def _is_overseer(user, workspace_slug):
    """Sees every lead regardless of team scope: the workspace owner, a workspace admin, or
    ANY team lead (BD or Dev). Mirrors the exemptions baked into bd_core.is_restricted_bd."""
    if Workspace.objects.filter(slug=workspace_slug, owner=user).exists():
        return True
    if bd_core.is_team_lead(user, workspace_slug):
        return True
    return WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug, member=user, is_active=True, role=ROLE.ADMIN.value
    ).exists()


def _is_project_admin(user, workspace_slug, project_id):
    """True if the user is an active ADMIN of THIS project. A project admin oversees their own
    project — they see every lead in it — but is NOT a workspace-wide overseer: this is
    project-scoped, so in projects they don't administer they stay team-scoped (no cross-project
    leak). Verified against the live ProjectMember row."""
    return ProjectMember.objects.filter(
        workspace__slug=workspace_slug,
        project_id=project_id,
        member=user,
        is_active=True,
        role=ROLE.ADMIN.value,
    ).exists()


def _admin_project_ids(user, workspace_slug):
    """The set of project ids in this workspace where the user is an active project ADMIN — the
    projects they oversee (see every lead in), used to widen the cross-project scope."""
    return set(
        ProjectMember.objects.filter(
            workspace__slug=workspace_slug, member=user, is_active=True, role=ROLE.ADMIN.value
        ).values_list("project_id", flat=True)
    )


def _restriction_kind(user, workspace_slug):
    """Classify the acting user's read restriction in this workspace:
      None             -> unrestricted (overseer, OR not an active member -> gated elsewhere)
      _KIND_BD         -> BD member, not an overseer -> profile-scoped
      _KIND_DEV        -> Dev member, not an overseer -> Assigned-Dev-scoped
      _KIND_UNASSIGNED -> active member with no team -> sees nothing (fail-closed).
    Edit/profile-write logic is intentionally NOT routed through here — it keeps using the
    BD-specific bd_core.is_restricted_bd, unchanged."""
    if not WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug, member=user, is_active=True
    ).exists():
        return None  # not an active member -> caller must not filter (handled by permission gates)
    if _is_overseer(user, workspace_slug):
        return None
    team = bd_core.member_team(user, workspace_slug)
    if team == WorkspaceTeam.BD:
        return _KIND_BD
    if team == WorkspaceTeam.DEV:
        return _KIND_DEV
    return _KIND_UNASSIGNED


def _profile_q(user, workspace_slug, project_id):
    """The profile-scoped Q for a BD member in one project (fail-closed). Extracted unchanged
    from the original restricted_issue_q body."""
    field_id = bd_core.resolve_profile_field_id(workspace_slug, project_id)
    if field_id is None:
        return _NONE_Q  # Profile field unresolved (e.g. renamed) -> see nothing.
    assigned = bd_core.assigned_profile_option_ids(user, workspace_slug, project_id)
    if not assigned:
        return _NONE_Q  # No assignments in this project -> see nothing.
    return _profile_match_q(field_id, assigned)


def restricted_issue_q(user, workspace_slug, project_id):
    """The Q the acting user's visible issues must satisfy for one project, or None if the user
    is NOT restricted (caller must not filter). Team-aware, fail-closed:
      overseer/non-member -> None; BD -> profile Q; Dev -> Assigned-Dev Q; unassigned -> nothing."""
    kind = _restriction_kind(user, workspace_slug)
    if kind is None:
        return None
    # A project admin oversees their OWN project: unrestricted for THIS project (project-scoped,
    # so they remain team-scoped in projects they don't administer -> no cross-project leak).
    if _is_project_admin(user, workspace_slug, project_id):
        return None
    if kind == _KIND_BD:
        return _profile_q(user, workspace_slug, project_id)
    if kind == _KIND_DEV:
        return _assigned_dev_match_q(user)
    return _NONE_Q  # _KIND_UNASSIGNED -> see nothing (Option B)


def scope_project_issues(queryset, user, workspace_slug, project_id):
    """Restrict a single-project issue queryset to what the acting user may see. No-op for
    non-restricted users."""
    q = restricted_issue_q(user, workspace_slug, project_id)
    return queryset if q is None else queryset.filter(q)


def scope_workspace_issues(queryset, user, workspace_slug):
    """Restrict a CROSS-PROJECT issue queryset to what the acting user may see. No-op for
    overseers / non-members. Team-aware:
      Dev  -> only leads where they are the Assigned Dev (matched by field name -> one cross-project filter);
      unassigned -> nothing;
      BD   -> only leads in projects where they hold a matching profile assignment (per-project OR)."""
    kind = _restriction_kind(user, workspace_slug)
    if kind is None:
        return queryset
    # Projects this user administers -> they see EVERY lead in those (project-scoped overseer),
    # OR'd with their team-based visibility everywhere else. Empty set -> match nothing extra.
    admin_ids = _admin_project_ids(user, workspace_slug)
    admin_q = Q(project_id__in=admin_ids) if admin_ids else _NONE_Q
    if kind == _KIND_DEV:
        return queryset.filter(_assigned_dev_match_q(user) | admin_q)
    if kind == _KIND_UNASSIGNED:
        return queryset.filter(admin_q)  # nothing except leads in projects they administer
    # _KIND_BD: admin projects (all leads) OR per-project profile scope.
    project_ids = set(
        ProfileAssignment.objects.filter(
            bd_member__workspace__slug=workspace_slug,
            bd_member__member=user,
            bd_member__is_active=True,
        ).values_list("project_id", flat=True)
    )
    combined = admin_q
    for project_id in project_ids:
        # Per-project: correct Profile field + assigned set (fail-closed per project).
        combined |= Q(project_id=project_id) & _profile_q(user, workspace_slug, project_id)
    return queryset.filter(combined)


def filter_issue_entity_rows(queryset, user, workspace_slug, entity_field="entity_name", issue_value="issue"):
    """Filter a queryset of rows that reference an entity by (kind, entity_identifier) — e.g.
    notifications, recent visits, favorites — so a restricted BD never sees a row pointing to
    a lead they may not see. Rows for the issue kind (`entity_field == issue_value`) are kept
    only when `entity_identifier` is a currently-visible lead; every other kind passes through.

    No-op for unrestricted users (owners, admins, team leads, non-members). Team-aware via
    scope_workspace_issues: BD -> profile-visible, Dev -> Assigned-Dev-visible, unassigned -> none.

    `entity_field` names the kind column: "entity_name" (notifications, recent visits) or
    "entity_type" (favorites)."""
    if _restriction_kind(user, workspace_slug) is None:
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
