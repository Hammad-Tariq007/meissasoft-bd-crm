# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Framework-agnostic BD Insights analytics core.

Pure aggregation functions that take an already-scoped Issue queryset (plus explicit
validated field ids / params) and return plain data dicts — no dependence on `self`,
`request`, or the app-view machinery. Both the session-authenticated app endpoint
(plane.app.views.analytic.bd_insights) and the token-authenticated public endpoint
(plane.api.views.bd_insights) call these, so the analytics logic lives in exactly one
place and both surfaces return identical results.

Scoping (workspace/project/date-range) is built by the shared get_analytics_filters()
util and applied here via scoped_issue_queryset(); callers just pass the filters.
"""

import uuid
from collections import defaultdict
from datetime import timedelta
from typing import Any, Dict, List, Optional

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, FilteredRelation, Q, QuerySet, Sum
from django.db.models.functions import TruncWeek

from plane.db.models import Issue, State, Workspace, WorkspaceMember
from plane.db.models.workspace import WorkspaceTeam
from plane.db.models.project import ROLE
from plane.db.models.bd_team import ProfileAssignment
from plane.db.models.custom_field import CustomFieldDefinition, CustomFieldOption, CustomFieldType, CustomFieldValue
from plane.utils.bd_deal_value import DEFAULT_HOURS_PER_WEEK, estimate_deal_value
from plane.utils.build_chart import build_leads_wins_by_field

# State groups that count as "closed" for win-rate purposes.
CLOSED_GROUPS = ["completed", "cancelled"]
WON_GROUP = "completed"
LOST_GROUP = "cancelled"

# State groups on the forward funnel path. Cancelled (lost) leads are off the
# forward path and reported as drop-outs; triage/None have no place in the funnel.
# Ordering WITHIN the funnel is by state.sequence, not by this set.
FORWARD_GROUPS = {"backlog", "unstarted", "started", "completed"}


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------
def _win_rate(won: int, closed: int) -> Optional[float]:
    """won / closed as a percentage, or None when nothing has closed. won is always a
    subset of closed within the same queryset, so the result is bounded to [0, 100]."""
    if not closed:
        return None
    return round((won / closed) * 100, 1)


def _duration_to_days(value: Optional[timedelta]) -> Optional[float]:
    if value is None:
        return None
    return round(value.total_seconds() / 86400, 1)


def scoped_issue_queryset(base_filters: Dict[str, Any], chart_period_range) -> QuerySet[Issue]:
    """Base issue queryset with workspace/project filters and the created_at date-range
    scope applied — identical to the other advance-analytics chart endpoints."""
    queryset = Issue.issue_objects.filter(**base_filters)
    if chart_period_range:
        start_date, end_date = chart_period_range
        queryset = queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)
    return queryset


def validate_field_id(
    raw: Optional[str], field_type: CustomFieldType, workspace_slug: str, project_ids_csv: Optional[str] = None
) -> Optional[uuid.UUID]:
    """Parse `raw` as a UUID and confirm it is an active custom field of the expected type
    inside the scoped workspace/projects. Returns None on any mismatch so callers can 400."""
    if not raw:
        return None
    try:
        field_id = uuid.UUID(raw)
    except (ValueError, TypeError):
        return None

    definition_query = CustomFieldDefinition.objects.filter(
        id=field_id,
        workspace__slug=workspace_slug,
        field_type=field_type,
        is_active=True,
    )
    if project_ids_csv:
        definition_query = definition_query.filter(project_id__in=[pid for pid in project_ids_csv.split(",")])
    if not definition_query.exists():
        return None
    return field_id


def parse_positive_float(raw: Optional[str], default: float) -> float:
    """Parse a positive float, falling back to default."""
    if not raw:
        return default
    try:
        value = float(raw)
    except (ValueError, TypeError):
        return default
    return value if value > 0 else default


def has_analytics_access(user, workspace_slug: str) -> bool:
    """The owner/flag half of the gate (the admin-role half is enforced by the caller):
    the workspace OWNER always has access; anyone else needs the additive
    can_view_analytics flag. Shared so both API surfaces gate identically."""
    if Workspace.objects.filter(slug=workspace_slug, owner=user).exists():
        return True
    return WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug, member=user, is_active=True, can_view_analytics=True
    ).exists()


# --- BD CRM team layer (Phase 1) reads. Thin indirection over the WorkspaceMember
# attributes so Phases 2/3 gate through these; storage could move to a sidecar later
# without touching callers. ---
def member_team(user, workspace_slug: str):
    """The member's team ("bd"/"dev") in this workspace, or None if unassigned / not a member."""
    return (
        WorkspaceMember.objects.filter(workspace__slug=workspace_slug, member=user, is_active=True)
        .values_list("team", flat=True)
        .first()
    )


def is_bd(user, workspace_slug: str) -> bool:
    """True if the member is on the BD team in this workspace."""
    return member_team(user, workspace_slug) == WorkspaceTeam.BD


def is_team_lead(user, workspace_slug: str, team=None) -> bool:
    """True if the member is a team lead in this workspace (optionally of a specific team)."""
    qs = WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug, member=user, is_active=True, is_team_lead=True
    )
    if team is not None:
        qs = qs.filter(team=team)
    return qs.exists()


def is_dev_lead(user, workspace_slug: str) -> bool:
    """True if the member is a Dev-team lead in this workspace (team=dev, is_team_lead).
    Dev leads own dev-assignment: they may set the 'Assigned Dev' field on any lead."""
    return is_team_lead(user, workspace_slug, team=WorkspaceTeam.DEV)


# --- BD CRM profile-assignment layer (Phase 2). ---

# The Profile field is identified by NAME (consistent with bd_insights / analytics).
# This is the ONE place that name lives — change it here if the field is ever renamed.
PROFILE_FIELD_NAME = "Profile"


def resolve_profile_field_id(workspace_slug: str, project_id):
    """Resolve the single-select 'Profile' field id for a project by NAME.

    Returns None if it cannot be found — callers MUST fail closed (deny a restricted BD),
    never fall open. A rename of the Profile field therefore surfaces as a loud, visible
    block on BD create/edit rather than a silent bypass of the restriction.
    """
    return (
        CustomFieldDefinition.objects.filter(
            workspace__slug=workspace_slug, project_id=project_id, name=PROFILE_FIELD_NAME
        )
        .values_list("id", flat=True)
        .first()
    )


# The MEMBER-type field that assigns a Dev-team member to a lead. Drives Dev read-visibility
# (bd_visibility) and is settable by admins / the owning BD / a Dev team-lead. Resolved by NAME
# (the ONE place the name lives), fail-closed like the Profile field: a rename surfaces as a
# loud block (Dev sees nothing), never a silent fall-open.
ASSIGNED_DEV_FIELD_NAME = "Assigned Dev"


def resolve_assigned_dev_field_id(workspace_slug: str, project_id):
    """Resolve the MEMBER 'Assigned Dev' field id for a project by NAME, or None if it cannot
    be found. Callers MUST fail closed (a Dev sees nothing) when None."""
    return (
        CustomFieldDefinition.objects.filter(
            workspace__slug=workspace_slug, project_id=project_id, name=ASSIGNED_DEV_FIELD_NAME
        )
        .values_list("id", flat=True)
        .first()
    )


def is_restricted_bd(user, workspace_slug: str) -> bool:
    """A regular BD subject to the profile restriction: on the BD team AND NOT the
    workspace owner, a workspace admin, or a team lead (those oversee everything)."""
    if not is_bd(user, workspace_slug):
        return False
    if Workspace.objects.filter(slug=workspace_slug, owner=user).exists():
        return False
    if is_team_lead(user, workspace_slug):
        return False
    if WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug, member=user, is_active=True, role=ROLE.ADMIN.value
    ).exists():
        return False
    return True


def assigned_profile_option_ids(user, workspace_slug: str, project_id) -> set:
    """The set of Profile CustomFieldOption ids assigned to this member IN THIS PROJECT
    (id-based, so renaming an option's label never changes what is assigned). Assignments
    are project-scoped: a BD can have different profiles in different projects."""
    return set(
        ProfileAssignment.objects.filter(
            bd_member__workspace__slug=workspace_slug,
            bd_member__member=user,
            bd_member__is_active=True,
            project_id=project_id,
        ).values_list("profile_option_id", flat=True)
    )


def bd_create_profile_error(user, workspace_slug: str, project_id, profile_option_id):
    """Validate a restricted BD's lead-creation: they MUST create with an assigned Profile
    supplied inline (`profile_option_id`). Returns (status, message) to REJECT, or None to
    allow. Fail closed: if the Profile field can't be resolved, block. Non-restricted users
    are never blocked here."""
    if not is_restricted_bd(user, workspace_slug):
        return None
    if resolve_profile_field_id(workspace_slug, project_id) is None:
        return (403, "Profile field is misconfigured; lead creation is blocked. Contact an admin.")
    oid = str(profile_option_id) if profile_option_id else ""
    if not oid:
        return (403, "As a BD you must create the lead with a Profile assigned to you.")
    if oid not in {str(x) for x in assigned_profile_option_ids(user, workspace_slug, project_id)}:
        return (403, "You can only create a lead with a profile assigned to you in this project.")
    return None


def set_profile_value(workspace_slug: str, project_id, issue_id, workspace_id, option_id) -> None:
    """Persist the Profile single-select value on a freshly created lead (upsert). No-op if
    the Profile field can't be resolved or no option is given."""
    field_id = resolve_profile_field_id(workspace_slug, project_id)
    if field_id is None or not option_id:
        return
    obj = CustomFieldValue.objects.filter(field_id=field_id, issue_id=issue_id).first()
    if obj is None:
        obj = CustomFieldValue(
            field_id=field_id, issue_id=issue_id, project_id=project_id, workspace_id=workspace_id
        )
    obj.value_option_id = option_id
    obj.save()


def collect_field_values(
    issue_ids: List[uuid.UUID], field_ids: List[uuid.UUID]
) -> Dict[uuid.UUID, Dict[uuid.UUID, Dict[str, Any]]]:
    """Load the given custom-field values for the given issues in one query, keyed as
    {issue_id: {field_id: {text, number, boolean, option}}}."""
    result: Dict[uuid.UUID, Dict[uuid.UUID, Dict[str, Any]]] = defaultdict(dict)
    if not issue_ids or not field_ids:
        return result
    values = CustomFieldValue.objects.filter(issue_id__in=issue_ids, field_id__in=field_ids).values(
        "issue_id", "field_id", "value_text", "value_number", "value_boolean", "value_option__name"
    )
    for v in values:
        result[v["issue_id"]][v["field_id"]] = {
            "text": v["value_text"],
            "number": v["value_number"],
            "boolean": v["value_boolean"],
            "option": v["value_option__name"],
        }
    return result


# ---------------------------------------------------------------------------
# aggregations (each takes a scoped queryset + explicit params, returns a data dict)
# ---------------------------------------------------------------------------
def win_rate(queryset: QuerySet[Issue]) -> Dict[str, Any]:
    """Win rate % overall + per BD."""
    overall = queryset.aggregate(
        won=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
        closed=Count("id", filter=Q(state__group__in=CLOSED_GROUPS), distinct=True),
    )
    per_bd_rows = (
        queryset.filter(assignees__isnull=False, issue_assignee__deleted_at__isnull=True)
        .values("assignees__id", "assignees__display_name")
        .annotate(
            won=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
            closed=Count("id", filter=Q(state__group__in=CLOSED_GROUPS), distinct=True),
        )
        .order_by("-won")
    )
    return {
        "overall": {
            "won": overall["won"] or 0,
            "closed": overall["closed"] or 0,
            "win_rate": _win_rate(overall["won"] or 0, overall["closed"] or 0),
        },
        "per_bd": [
            {
                "assignee_id": str(row["assignees__id"]),
                "assignee_name": row["assignees__display_name"],
                "won": row["won"],
                "closed": row["closed"],
                "win_rate": _win_rate(row["won"], row["closed"]),
            }
            for row in per_bd_rows
        ],
    }


def stage_distribution(queryset: QuerySet[Issue]) -> Dict[str, Any]:
    """Current distribution by stage (snapshot, NOT a historical funnel)."""
    data = (
        queryset.values("state__id", "state__name", "state__group", "state__sequence")
        .annotate(count=Count("id", distinct=True))
        .order_by("state__sequence")
    )
    return {
        "data": [
            {
                "key": str(item["state__id"]),
                "name": item["state__name"],
                "group": item["state__group"],
                "count": item["count"],
            }
            for item in data
        ]
    }


def conversion_funnel(queryset: QuerySet[Issue]) -> Dict[str, Any]:
    """Current-snapshot cumulative funnel, ordered by state.sequence; cancelled leads are
    the drop-out bucket. reached(stage) = leads at that stage OR any later forward stage."""
    rows = (
        queryset.filter(state__isnull=False)
        .values("state__id", "state__name", "state__group", "state__sequence")
        .annotate(count=Count("id", distinct=True))
    )

    lost_count = 0
    forward: List[Dict[str, Any]] = []
    for r in rows:
        group = r["state__group"]
        if group == LOST_GROUP:
            lost_count += r["count"]
            continue
        if group not in FORWARD_GROUPS:  # triage / unknown -> not on the funnel
            continue
        forward.append(
            {
                "key": str(r["state__id"]),
                "name": r["state__name"],
                "group": group,
                "count": r["count"],
                "sequence": r["state__sequence"] if r["state__sequence"] is not None else 0,
            }
        )

    forward.sort(key=lambda s: s["sequence"])

    reached = 0
    for stage in reversed(forward):
        reached += stage["count"]
        stage["reached"] = reached

    entered_count = forward[0]["reached"] if forward else 0

    stages: List[Dict[str, Any]] = []
    biggest_leak_index: Optional[int] = None
    worst_stall = -1.0
    for i, stage in enumerate(forward):
        conversion_to_next: Optional[float] = None
        is_last = i == len(forward) - 1
        if not is_last and stage["reached"]:
            next_reached = forward[i + 1]["reached"]
            conversion_to_next = round(next_reached / stage["reached"] * 100, 1)
            stall_rate = (stage["reached"] - next_reached) / stage["reached"]
            if stall_rate > worst_stall:
                worst_stall = stall_rate
                biggest_leak_index = i
        stages.append(
            {
                "key": stage["key"],
                "name": stage["name"],
                "group": stage["group"],
                "count": stage["count"],
                "reached": stage["reached"],
                "conversion_to_next": conversion_to_next,
            }
        )

    return {
        "assumption": "current_snapshot_cumulative",
        "entered_count": entered_count,
        "lost_count": lost_count,
        "biggest_leak_index": biggest_leak_index,
        "stages": stages,
    }


def time_to_close(queryset: QuerySet[Issue]) -> Dict[str, Any]:
    """Avg time-to-close (WON-ONLY approximation), overall + per BD."""
    won_queryset = queryset.filter(state__group=WON_GROUP, completed_at__isnull=False)
    ttc = ExpressionWrapper(F("completed_at") - F("created_at"), output_field=DurationField())

    overall = won_queryset.aggregate(avg=Avg(ttc), count=Count("id", distinct=True))

    per_bd_rows = (
        won_queryset.filter(assignees__isnull=False, issue_assignee__deleted_at__isnull=True)
        .values("assignees__id", "assignees__display_name")
        .annotate(avg=Avg(ttc), count=Count("id", distinct=True))
        .order_by("avg")
    )

    return {
        "approximation": "won_only",
        "overall": {
            "avg_days": _duration_to_days(overall["avg"]),
            "count": overall["count"] or 0,
        },
        "per_bd": [
            {
                "assignee_id": str(row["assignees__id"]),
                "assignee_name": row["assignees__display_name"],
                "avg_days": _duration_to_days(row["avg"]),
                "count": row["count"],
            }
            for row in per_bd_rows
        ],
    }


def cycle_by_field(queryset: QuerySet[Issue], field_id: uuid.UUID) -> Dict[str, Any]:
    """Avg days from creation to Won, bucketed by a single-select field. Won leads only."""
    won = queryset.filter(state__group=WON_GROUP, completed_at__isnull=False)
    ttc = ExpressionWrapper(F("completed_at") - F("created_at"), output_field=DurationField())
    alias = "cf_cycle"
    rows = (
        won.annotate(**{alias: FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=field_id))})
        .values(f"{alias}__value_option_id", f"{alias}__value_option__name")
        .annotate(avg=Avg(ttc), count=Count("id", distinct=True))
        .order_by("avg")
    )
    data = [
        {
            "key": str(r[f"{alias}__value_option_id"]) if r[f"{alias}__value_option_id"] else "none",
            "name": r[f"{alias}__value_option__name"] or "None",
            "avg_days": _duration_to_days(r["avg"]),
            "count": r["count"],
        }
        for r in rows
    ]
    return {"field_id": str(field_id), "data": data}


def velocity(
    queryset: QuerySet[Issue],
    rate_id: Optional[uuid.UUID],
    weeks_id: Optional[uuid.UUID],
    contract_id: Optional[uuid.UUID],
    hours_per_week: float,
) -> Dict[str, Any]:
    """Sales velocity = (open opps × avg deal value × win rate) / avg cycle length, $/day."""
    counts = queryset.aggregate(
        won=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
        closed=Count("id", filter=Q(state__group__in=CLOSED_GROUPS), distinct=True),
    )
    won_count = counts["won"] or 0
    win_rate_value = _win_rate(won_count, counts["closed"] or 0)

    open_opps = queryset.filter(state__isnull=False).exclude(state__group__in=CLOSED_GROUPS).count()

    ttc = ExpressionWrapper(F("completed_at") - F("created_at"), output_field=DurationField())
    avg_cycle_days = _duration_to_days(
        queryset.filter(state__group=WON_GROUP, completed_at__isnull=False).aggregate(avg=Avg(ttc))["avg"]
    )

    revenue_enabled = rate_id is not None and contract_id is not None
    avg_deal_value: Optional[float] = None
    counted = 0
    excluded = 0
    if revenue_enabled:
        won_ids = list(queryset.filter(state__group=WON_GROUP).values_list("id", flat=True))
        per_issue = collect_field_values(won_ids, [fid for fid in (rate_id, weeks_id, contract_id) if fid])
        total = 0.0
        for issue_id in won_ids:
            fields = per_issue.get(issue_id, {})
            weeks = fields.get(weeks_id, {}).get("number") if weeks_id else None
            value = estimate_deal_value(
                fields.get(rate_id, {}).get("text"),
                float(weeks) if weeks is not None else None,
                fields.get(contract_id, {}).get("option"),
                hours_per_week,
            )
            if value is None:
                excluded += 1
            else:
                total += value
                counted += 1
        avg_deal_value = round(total / counted, 1) if counted else None

    velocity_per_day: Optional[float] = None
    if avg_deal_value is not None and win_rate_value is not None and avg_cycle_days:
        velocity_per_day = round(open_opps * avg_deal_value * (win_rate_value / 100) / avg_cycle_days, 1)

    return {
        "revenue_enabled": revenue_enabled,
        "hours_per_week": hours_per_week,
        "open_opps": open_opps,
        "avg_deal_value": avg_deal_value,
        "win_rate": win_rate_value,
        "avg_cycle_days": avg_cycle_days,
        "velocity_per_day": velocity_per_day,
        "won_value_counted": counted,
        "won_value_excluded": excluded,
    }


def forecast(
    queryset: QuerySet[Issue],
    rate_id: Optional[uuid.UUID],
    weeks_id: Optional[uuid.UUID],
    contract_id: Optional[uuid.UUID],
    hours_per_week: float,
) -> Dict[str, Any]:
    """Weighted pipeline: each OPEN lead weighted by its stage win-probability × est. deal value."""
    state_rows = (
        queryset.filter(state__isnull=False)
        .values("state__id", "state__group", "state__sequence")
        .annotate(count=Count("id", distinct=True))
    )
    won_count = 0
    forward: List[Dict[str, Any]] = []
    for r in state_rows:
        group = r["state__group"]
        if group == WON_GROUP:
            won_count += r["count"]
        if group not in FORWARD_GROUPS:
            continue
        forward.append(
            {
                "id": r["state__id"],
                "count": r["count"],
                "sequence": r["state__sequence"] if r["state__sequence"] is not None else 0,
            }
        )
    forward.sort(key=lambda s: s["sequence"])
    reached_by_state: Dict[Any, int] = {}
    reached = 0
    for stage in reversed(forward):
        reached += stage["count"]
        reached_by_state[stage["id"]] = reached

    def win_prob(state_id: Any) -> float:
        r = reached_by_state.get(state_id)
        if not r:
            return 0.0
        return min(won_count / r, 1.0)

    open_leads = list(
        queryset.filter(state__isnull=False)
        .exclude(state__group__in=CLOSED_GROUPS)
        .values("id", "state__id", "state__name", "state__sequence")
    )
    per_issue = collect_field_values(
        [lead["id"] for lead in open_leads], [fid for fid in (rate_id, weeks_id, contract_id) if fid]
    )
    revenue_enabled = rate_id is not None and contract_id is not None

    stage_agg: Dict[Any, Dict[str, Any]] = {}
    forecast_value = 0.0
    open_valued = 0
    open_excluded = 0
    for lead in open_leads:
        state_id = lead["state__id"]
        prob = win_prob(state_id)
        agg = stage_agg.setdefault(
            state_id,
            {
                "name": lead["state__name"],
                "sequence": lead["state__sequence"] if lead["state__sequence"] is not None else 0,
                "win_prob": round(prob * 100, 1),
                "open_count": 0,
                "weighted_value": 0.0,
            },
        )
        agg["open_count"] += 1

        if revenue_enabled:
            fields = per_issue.get(lead["id"], {})
            weeks = fields.get(weeks_id, {}).get("number") if weeks_id else None
            value = estimate_deal_value(
                fields.get(rate_id, {}).get("text"),
                float(weeks) if weeks is not None else None,
                fields.get(contract_id, {}).get("option"),
                hours_per_week,
            )
            if value is None:
                open_excluded += 1
            else:
                weighted = value * prob
                agg["weighted_value"] += weighted
                forecast_value += weighted
                open_valued += 1

    stages = sorted(stage_agg.values(), key=lambda s: s["sequence"])
    for s in stages:
        s["weighted_value"] = round(s["weighted_value"], 1)
        del s["sequence"]

    return {
        "revenue_enabled": revenue_enabled,
        "hours_per_week": hours_per_week,
        "forecast_value": round(forecast_value, 1) if revenue_enabled else None,
        "open_total": len(open_leads),
        "open_valued": open_valued,
        "open_excluded": open_excluded,
        "stages": stages,
    }


def loss_reasons(queryset: QuerySet[Issue], field_id: uuid.UUID) -> Dict[str, Any]:
    """Breakdown of LOST leads by a single-select field."""
    lost = queryset.filter(state__group=LOST_GROUP)
    alias = "cf_loss"
    rows = (
        lost.annotate(**{alias: FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=field_id))})
        .values(f"{alias}__value_option_id", f"{alias}__value_option__name")
        .annotate(count=Count("id", distinct=True))
        .order_by("-count")
    )
    data = [
        {
            "key": str(r[f"{alias}__value_option_id"]) if r[f"{alias}__value_option_id"] else "none",
            "name": r[f"{alias}__value_option__name"] or "Unspecified",
            "count": r["count"],
        }
        for r in rows
    ]
    return {"field_id": str(field_id), "total": sum(r["count"] for r in data), "data": data}


def by_field(queryset: QuerySet[Issue], field_id: uuid.UUID) -> Dict[str, Any]:
    """Leads & wins by a single-select custom field (Profile / Country)."""
    return {"field_id": str(field_id), "data": build_leads_wins_by_field(queryset, field_id)}


def connects(
    queryset: QuerySet[Issue], spent_field_id: uuid.UUID, boost_field_id: Optional[uuid.UUID]
) -> Dict[str, Any]:
    """Connects efficiency: totals + connects-per-win, optionally with boost totals."""
    annotated = queryset.annotate(
        cf_spent=FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=spent_field_id))
    )
    aggregates = annotated.aggregate(
        spent_total=Sum("cf_spent__value_number"),
        spent_on_won=Sum("cf_spent__value_number", filter=Q(state__group=WON_GROUP)),
        spent_on_lost=Sum("cf_spent__value_number", filter=Q(state__group=LOST_GROUP)),
        won_count=Count("id", filter=Q(state__group=WON_GROUP), distinct=True),
    )

    spent_on_won = aggregates["spent_on_won"] or 0
    won_count = aggregates["won_count"] or 0
    data = {
        "spent_total": aggregates["spent_total"] or 0,
        "spent_on_won": spent_on_won,
        "spent_on_lost": aggregates["spent_on_lost"] or 0,
        "won_count": won_count,
        "connects_per_win": round(spent_on_won / won_count, 1) if won_count else None,
    }

    if boost_field_id is not None:
        boost = queryset.annotate(
            cf_boost=FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=boost_field_id))
        ).aggregate(
            boost_total=Sum("cf_boost__value_number"),
            boost_on_won=Sum("cf_boost__value_number", filter=Q(state__group=WON_GROUP)),
        )
        data["boost_total"] = boost["boost_total"] or 0
        data["boost_on_won"] = boost["boost_on_won"] or 0

    return data


def economics_by_segment(
    queryset: QuerySet[Issue],
    seg_id: uuid.UUID,
    spent_id: uuid.UUID,
    rate_id: Optional[uuid.UUID],
    weeks_id: Optional[uuid.UUID],
    contract_id: Optional[uuid.UUID],
    hours_per_week: float,
) -> Dict[str, Any]:
    """Per-slice connects economics for a single-select segment (connects ROI + rev/connect)."""
    revenue_enabled = rate_id is not None and contract_id is not None

    issues = {row["id"]: row["state__group"] for row in queryset.values("id", "state__group")}
    field_ids = [fid for fid in (seg_id, spent_id, rate_id, weeks_id, contract_id) if fid is not None]
    per_issue = collect_field_values(list(issues), field_ids)

    buckets: Dict[str, Dict[str, Any]] = {}

    def bucket(name: str) -> Dict[str, Any]:
        return buckets.setdefault(
            name,
            {
                "leads": 0, "wins": 0, "closed": 0,
                "spent_total": 0.0, "spent_on_won": 0.0,
                "won_value": 0.0, "won_value_counted": 0, "won_value_excluded": 0,
            },
        )

    for issue_id, group in issues.items():
        fields = per_issue.get(issue_id, {})
        seg_name = fields.get(seg_id, {}).get("option") or "None"
        spent = float(fields.get(spent_id, {}).get("number") or 0)
        b = bucket(seg_name)
        b["leads"] += 1
        b["spent_total"] += spent
        if group in CLOSED_GROUPS:
            b["closed"] += 1
        if group == WON_GROUP:
            b["wins"] += 1
            b["spent_on_won"] += spent
            if revenue_enabled:
                weeks = fields.get(weeks_id, {}).get("number") if weeks_id else None
                value = estimate_deal_value(
                    fields.get(rate_id, {}).get("text"),
                    float(weeks) if weeks is not None else None,
                    fields.get(contract_id, {}).get("option"),
                    hours_per_week,
                )
                if value is None:
                    b["won_value_excluded"] += 1
                else:
                    b["won_value"] += value
                    b["won_value_counted"] += 1

    rows: List[Dict[str, Any]] = []
    for name, b in buckets.items():
        has_revenue = revenue_enabled and b["won_value_counted"] > 0 and b["spent_on_won"] > 0
        rows.append(
            {
                "key": name,
                "name": name,
                "leads": b["leads"],
                "wins": b["wins"],
                "closed": b["closed"],
                "win_rate": _win_rate(b["wins"], b["closed"]),
                "spent_total": round(b["spent_total"], 1),
                "spent_on_won": round(b["spent_on_won"], 1),
                "connects_per_win": round(b["spent_on_won"] / b["wins"], 1) if b["wins"] else None,
                "won_value": round(b["won_value"], 1) if has_revenue else None,
                "revenue_per_connect": round(b["won_value"] / b["spent_on_won"], 1) if has_revenue else None,
                "won_value_excluded": b["won_value_excluded"],
            }
        )
    rows.sort(key=lambda r: r["spent_total"], reverse=True)

    return {"revenue_enabled": revenue_enabled, "hours_per_week": hours_per_week, "data": rows}


def boosted_effectiveness(queryset: QuerySet[Issue], flag_id: uuid.UUID, spent_id: uuid.UUID) -> Dict[str, Any]:
    """Boosted vs non-boosted: win rate and connects-per-win for each bucket."""
    issues = {row["id"]: row["state__group"] for row in queryset.values("id", "state__group")}
    per_issue = collect_field_values(list(issues), [flag_id, spent_id])

    agg = {
        True: {"won": 0, "closed": 0, "leads": 0, "spent_on_won": 0.0},
        False: {"won": 0, "closed": 0, "leads": 0, "spent_on_won": 0.0},
    }
    for issue_id, group in issues.items():
        fields = per_issue.get(issue_id, {})
        boosted = bool(fields.get(flag_id, {}).get("boolean"))
        spent = float(fields.get(spent_id, {}).get("number") or 0)
        b = agg[boosted]
        b["leads"] += 1
        if group in CLOSED_GROUPS:
            b["closed"] += 1
        if group == WON_GROUP:
            b["won"] += 1
            b["spent_on_won"] += spent

    def shape(label: str, b: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "key": label,
            "name": label,
            "leads": b["leads"],
            "won": b["won"],
            "closed": b["closed"],
            "win_rate": _win_rate(b["won"], b["closed"]),
            "connects_per_win": round(b["spent_on_won"] / b["won"], 1) if b["won"] else None,
        }

    return {"data": [shape("Boosted", agg[True]), shape("Not boosted", agg[False])]}


def trend(queryset: QuerySet[Issue], base_filters: Dict[str, Any], chart_period_range) -> Dict[str, Any]:
    """Weekly trend: leads by created_at week + wins by completed_at week (zero-filled)."""
    created_rows = (
        queryset.annotate(week=TruncWeek("created_at"))
        .values("week")
        .annotate(count=Count("id", distinct=True))
        .order_by("week")
    )

    wins_queryset = Issue.issue_objects.filter(**base_filters, state__group=WON_GROUP, completed_at__isnull=False)
    if chart_period_range:
        start_date, end_date = chart_period_range
        wins_queryset = wins_queryset.filter(completed_at__date__gte=start_date, completed_at__date__lte=end_date)
    wins_rows = (
        wins_queryset.annotate(week=TruncWeek("completed_at"))
        .values("week")
        .annotate(count=Count("id", distinct=True))
        .order_by("week")
    )

    created_by_week = {row["week"].date(): row["count"] for row in created_rows if row["week"]}
    wins_by_week = {row["week"].date(): row["count"] for row in wins_rows if row["week"]}

    all_weeks = sorted(set(created_by_week) | set(wins_by_week))
    if not all_weeks:
        return {"data": []}

    data = []
    current = all_weeks[0]
    last = all_weeks[-1]
    while current <= last:
        data.append(
            {
                "week": current.strftime("%Y-%m-%d"),
                "created": created_by_week.get(current, 0),
                "wins": wins_by_week.get(current, 0),
            }
        )
        current = current + timedelta(weeks=1)

    return {"data": data}


# ---------------------------------------------------------------------------
# dispatch: route a `type` to its aggregation (shared validation + 400s)
# ---------------------------------------------------------------------------
def dispatch_insight(
    insight_type: Optional[str],
    queryset: QuerySet[Issue],
    base_filters: Dict[str, Any],
    chart_period_range,
    workspace_slug: str,
    project_ids_csv: Optional[str],
    get_param,
):
    """Route `type` to its aggregation and return (http_status, payload_dict). `get_param(name)`
    returns a raw query-string value (or None). Field-id validation and the 400 messages live
    here so the session (app) and token (public) endpoints behave identically."""

    def field(param: str, ftype: CustomFieldType) -> Optional[uuid.UUID]:
        return validate_field_id(get_param(param), ftype, workspace_slug, project_ids_csv)

    def hours() -> float:
        return parse_positive_float(get_param("hours_per_week"), DEFAULT_HOURS_PER_WEEK)

    if insight_type == "win-rate":
        return 200, win_rate(queryset)
    if insight_type == "funnel":
        return 200, stage_distribution(queryset)
    if insight_type == "conversion-funnel":
        return 200, conversion_funnel(queryset)
    if insight_type == "time-to-close":
        return 200, time_to_close(queryset)
    if insight_type == "trend":
        return 200, trend(queryset, base_filters, chart_period_range)

    if insight_type == "by-field":
        fid = field("field_id", CustomFieldType.SINGLE_SELECT)
        if fid is None:
            return 400, {"error": "A valid single-select `field_id` is required"}
        return 200, by_field(queryset, fid)

    if insight_type == "connects":
        spent_id = field("spent_field_id", CustomFieldType.NUMBER)
        if spent_id is None:
            return 400, {"error": "A valid number `spent_field_id` is required"}
        boost_id = field("boost_field_id", CustomFieldType.NUMBER)
        return 200, connects(queryset, spent_id, boost_id)

    if insight_type == "economics-by-segment":
        seg_id = field("field_id", CustomFieldType.SINGLE_SELECT)
        spent_id = field("spent_field_id", CustomFieldType.NUMBER)
        if seg_id is None or spent_id is None:
            return 400, {"error": "Valid single-select `field_id` and number `spent_field_id` are required"}
        return 200, economics_by_segment(
            queryset,
            seg_id,
            spent_id,
            field("rate_field_id", CustomFieldType.TEXT),
            field("weeks_field_id", CustomFieldType.NUMBER),
            field("contract_field_id", CustomFieldType.SINGLE_SELECT),
            hours(),
        )

    if insight_type == "boosted":
        flag_id = field("flag_field_id", CustomFieldType.CHECKBOX)
        spent_id = field("spent_field_id", CustomFieldType.NUMBER)
        if flag_id is None or spent_id is None:
            return 400, {"error": "Valid checkbox `flag_field_id` and number `spent_field_id` are required"}
        return 200, boosted_effectiveness(queryset, flag_id, spent_id)

    if insight_type == "cycle-by-field":
        fid = field("field_id", CustomFieldType.SINGLE_SELECT)
        if fid is None:
            return 400, {"error": "A valid single-select `field_id` is required"}
        return 200, cycle_by_field(queryset, fid)

    if insight_type == "velocity":
        return 200, velocity(
            queryset,
            field("rate_field_id", CustomFieldType.TEXT),
            field("weeks_field_id", CustomFieldType.NUMBER),
            field("contract_field_id", CustomFieldType.SINGLE_SELECT),
            hours(),
        )

    if insight_type == "forecast":
        return 200, forecast(
            queryset,
            field("rate_field_id", CustomFieldType.TEXT),
            field("weeks_field_id", CustomFieldType.NUMBER),
            field("contract_field_id", CustomFieldType.SINGLE_SELECT),
            hours(),
        )

    if insight_type == "loss-reasons":
        fid = field("field_id", CustomFieldType.SINGLE_SELECT)
        if fid is None:
            return 400, {"error": "A valid single-select `field_id` is required"}
        return 200, loss_reasons(queryset, fid)

    return 400, {"error": "Invalid or missing `type`"}


# ---------------------------------------------------------------------------
# metadata + lead listing (for the token-authenticated MCP client)
# ---------------------------------------------------------------------------
def _bd_field_definitions(workspace_slug: str, project_ids_csv: Optional[str]) -> List[CustomFieldDefinition]:
    q = CustomFieldDefinition.objects.filter(workspace__slug=workspace_slug, is_active=True)
    if project_ids_csv:
        q = q.filter(project_id__in=[pid for pid in project_ids_csv.split(",")])
    return list(q)


def bd_metadata(workspace_slug: str, project_ids_csv: Optional[str]) -> Dict[str, Any]:
    """Field definitions (name -> id/type/options) and states — so a client can resolve
    field names to ids and know the valid filter values (profiles/countries/etc.)."""
    defs = _bd_field_definitions(workspace_slug, project_ids_csv)
    options: Dict[Any, List[Dict[str, str]]] = defaultdict(list)
    for o in (
        CustomFieldOption.objects.filter(field__in=defs, is_active=True)
        .values("id", "name", "field_id")
        .order_by("sequence", "name")
    ):
        options[o["field_id"]].append({"id": str(o["id"]), "name": o["name"]})

    fields = [
        {"id": str(d.id), "name": d.name, "type": d.field_type, "options": options.get(d.id, [])} for d in defs
    ]

    state_q = State.objects.filter(workspace__slug=workspace_slug)
    if project_ids_csv:
        state_q = state_q.filter(project_id__in=[pid for pid in project_ids_csv.split(",")])
    states = [
        {"id": str(s.id), "name": s.name, "group": s.group, "sequence": s.sequence}
        for s in state_q.order_by("sequence")
    ]
    return {"fields": fields, "states": states}


def _coerce_field_value(vals: Dict[str, Any]) -> Any:
    """Pick the populated typed value for a lead's custom field (JSON-safe)."""
    if vals.get("option") is not None:
        return vals["option"]
    if vals.get("text") is not None:
        return vals["text"]
    if vals.get("number") is not None:
        return float(vals["number"])
    return vals.get("boolean")


def list_leads(
    queryset: QuerySet[Issue],
    workspace_slug: str,
    project_ids_csv: Optional[str],
    state: Optional[str] = None,
    profile: Optional[str] = None,
    country: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """Paginated, read-only lead list with key fields + BD custom-field values. Filter by
    state (name or group) and by Profile / Country option name; date scope is already on the
    passed queryset."""
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))

    field_map = {d.name: d for d in _bd_field_definitions(workspace_slug, project_ids_csv)}

    qs = queryset
    if state:
        qs = qs.filter(Q(state__name__iexact=state) | Q(state__group__iexact=state))

    def cf_filter(base, field_name: str, option_name: Optional[str]):
        definition = field_map.get(field_name)
        if not definition or not option_name:
            return base
        alias = f"cf_flt_{field_name.replace(' ', '_')}"
        return base.annotate(
            **{alias: FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=definition.id))}
        ).filter(**{f"{alias}__value_option__name__iexact": option_name})

    qs = cf_filter(qs, "Profile", profile)
    qs = cf_filter(qs, "Country", country)
    qs = qs.order_by("-created_at")

    total = qs.distinct().count()
    page = list(
        qs.distinct().values(
            "id", "name", "sequence_id", "created_at", "completed_at",
            "state__name", "state__group", "project__identifier",
        )[offset : offset + limit]
    )

    ids = [r["id"] for r in page]
    per_issue = collect_field_values(ids, [d.id for d in field_map.values()])
    id_to_name = {d.id: d.name for d in field_map.values()}

    results = []
    for r in page:
        custom = {}
        for fid, vals in per_issue.get(r["id"], {}).items():
            name = id_to_name.get(fid)
            if name:
                custom[name] = _coerce_field_value(vals)
        results.append(
            {
                "id": str(r["id"]),
                "identifier": f'{r["project__identifier"]}-{r["sequence_id"]}',
                "name": r["name"],
                "state": {"name": r["state__name"], "group": r["state__group"]},
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                "fields": custom,
            }
        )
    return {"count": total, "limit": limit, "offset": offset, "results": results}
