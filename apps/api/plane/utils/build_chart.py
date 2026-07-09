# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid
from typing import Dict, Any, Tuple, Optional, List, Union, Set


# Django imports
from django.db.models import (
    Count,
    F,
    FilteredRelation,
    Q,
    QuerySet,
    Aggregate,
)

from plane.db.models import Issue
from rest_framework.exceptions import ValidationError

# x_axis / group_by values of this shape select a single-select custom field as a
# grouping dimension, e.g. "CUSTOM_FIELD_1b7c…". The suffix is the field's UUID.
CUSTOM_FIELD_PREFIX = "CUSTOM_FIELD_"


x_axis_mapper = {
    "STATES": "STATES",
    "STATE_GROUPS": "STATE_GROUPS",
    "LABELS": "LABELS",
    "ASSIGNEES": "ASSIGNEES",
    "ESTIMATE_POINTS": "ESTIMATE_POINTS",
    "CYCLES": "CYCLES",
    "MODULES": "MODULES",
    "PRIORITY": "PRIORITY",
    "START_DATE": "START_DATE",
    "TARGET_DATE": "TARGET_DATE",
    "CREATED_AT": "CREATED_AT",
    "COMPLETED_AT": "COMPLETED_AT",
    "CREATED_BY": "CREATED_BY",
}


def get_y_axis_filter(y_axis: str) -> Dict[str, Any]:
    filter_mapping = {
        "WORK_ITEM_COUNT": {"id": F("id")},
    }
    return filter_mapping.get(y_axis, {})


def get_x_axis_field() -> Dict[str, Tuple[str, str, Optional[Dict[str, Any]]]]:
    return {
        "STATES": ("state__id", "state__name", None),
        "STATE_GROUPS": ("state__group", "state__group", None),
        "LABELS": (
            "labels__id",
            "labels__name",
            {"label_issue__deleted_at__isnull": True},
        ),
        "ASSIGNEES": (
            "assignees__id",
            "assignees__display_name",
            {"issue_assignee__deleted_at__isnull": True},
        ),
        "ESTIMATE_POINTS": ("estimate_point__key", "estimate_point__value", None),
        "CYCLES": (
            "issue_cycle__cycle_id",
            "issue_cycle__cycle__name",
            {"issue_cycle__deleted_at__isnull": True},
        ),
        "MODULES": (
            "issue_module__module_id",
            "issue_module__module__name",
            {"issue_module__deleted_at__isnull": True},
        ),
        "PRIORITY": ("priority", "priority", None),
        "START_DATE": ("start_date", "start_date", None),
        "TARGET_DATE": ("target_date", "target_date", None),
        "CREATED_AT": ("created_at__date", "created_at__date", None),
        "COMPLETED_AT": ("completed_at__date", "completed_at__date", None),
        "CREATED_BY": ("created_by_id", "created_by__display_name", None),
    }


def process_grouped_data(
    data: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    response = {}
    schema = {}

    for item in data:
        key = item["key"]
        if key not in response:
            response[key] = {
                "key": key if key else "none",
                "name": (item.get("display_name", key) if item.get("display_name", key) else "None"),
                "count": 0,
            }
        group_key = str(item["group_key"]) if item["group_key"] else "none"
        schema[group_key] = item.get("group_name", item["group_key"])
        schema[group_key] = schema[group_key] if schema[group_key] else "None"
        response[key][group_key] = response[key].get(group_key, 0) + item["count"]
        response[key]["count"] += item["count"]

    return list(response.values()), schema


def build_number_chart_response(
    queryset: QuerySet[Issue],
    y_axis_filter: Dict[str, Any],
    y_axis: str,
    aggregate_func: Aggregate,
) -> List[Dict[str, Any]]:
    count = queryset.filter(**y_axis_filter).aggregate(total=aggregate_func).get("total", 0)
    return [{"key": y_axis, "name": y_axis, "count": count}]


def build_grouped_chart_response(
    queryset: QuerySet[Issue],
    id_field: str,
    name_field: str,
    group_field: str,
    group_name_field: str,
    aggregate_func: Aggregate,
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    data = (
        queryset.annotate(
            key=F(id_field),
            group_key=F(group_field),
            group_name=F(group_name_field),
            display_name=F(name_field) if name_field else F(id_field),
        )
        .values("key", "group_key", "group_name", "display_name")
        .annotate(count=aggregate_func)
        .order_by("-count")
    )
    return process_grouped_data(data)


def build_simple_chart_response(
    queryset: QuerySet, id_field: str, name_field: str, aggregate_func: Aggregate
) -> List[Dict[str, Any]]:
    data = (
        queryset.annotate(key=F(id_field), display_name=F(name_field) if name_field else F(id_field))
        .values("key", "display_name")
        .annotate(count=aggregate_func)
        .order_by("key")
    )

    return [
        {
            "key": item["key"] if item["key"] else "None",
            "name": item["display_name"] if item["display_name"] else "None",
            "count": item["count"],
        }
        for item in data
    ]


def resolve_axis_field(
    queryset: QuerySet[Issue],
    axis: str,
    alias: str,
    allowed_custom_field_ids: Optional[Set[uuid.UUID]],
) -> Tuple[QuerySet[Issue], str, str, Optional[Dict[str, Any]]]:
    """Resolve an x_axis/group_by key to (queryset, id_field, name_field, additional_filter).

    Native keys use the static mapping. A key shaped ``CUSTOM_FIELD_<uuid>`` selects
    a single-select custom field: we LEFT JOIN (FilteredRelation) onto just that
    field's value under ``alias`` so issues with no value fall into a "None" bucket
    and two custom dimensions never collide on the shared custom_field_values join.
    The returned field paths reference the alias; no queryset filter is needed for
    custom fields (the field scoping lives inside the FilteredRelation condition).
    """
    field_mapping = get_x_axis_field()
    if axis in field_mapping:
        id_field, name_field, additional_filter = field_mapping[axis]
        return queryset, id_field, name_field, additional_filter

    if isinstance(axis, str) and axis.startswith(CUSTOM_FIELD_PREFIX):
        raw_id = axis[len(CUSTOM_FIELD_PREFIX) :]
        try:
            field_id = uuid.UUID(raw_id)
        except ValueError:
            raise ValidationError(f"Invalid custom field dimension: {axis}")
        if not allowed_custom_field_ids or field_id not in allowed_custom_field_ids:
            raise ValidationError(f"'{axis}' is not a groupable single-select custom field")
        queryset = queryset.annotate(
            **{alias: FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=field_id))}
        )
        return queryset, f"{alias}__value_option_id", f"{alias}__value_option__name", None

    raise ValidationError(f"Invalid dimension: {axis}")


def build_leads_wins_by_field(
    queryset: QuerySet[Issue],
    field_id: uuid.UUID,
) -> List[Dict[str, Any]]:
    """Leads and wins bucketed by a single-select custom field's option value.

    Reuses the same FilteredRelation join as the CUSTOM_FIELD grouping path so
    issues with no value for the field fall into a "None" bucket. "wins" counts
    only issues whose state is in the completed group; both counts are distinct
    so a multi-value/relation join can never inflate them.
    """
    alias = "cf_by_field"
    data = (
        queryset.annotate(
            **{alias: FilteredRelation("custom_field_values", condition=Q(custom_field_values__field_id=field_id))}
        )
        .values(f"{alias}__value_option_id", f"{alias}__value_option__name")
        .annotate(
            leads=Count("id", distinct=True),
            wins=Count("id", filter=Q(state__group="completed"), distinct=True),
            # closed = won + lost, so a per-slice win rate (wins / closed) can be derived downstream.
            closed=Count("id", filter=Q(state__group__in=["completed", "cancelled"]), distinct=True),
        )
        .order_by("-leads")
    )
    return [
        {
            "key": str(item[f"{alias}__value_option_id"]) if item[f"{alias}__value_option_id"] else "none",
            "name": item[f"{alias}__value_option__name"] or "None",
            "leads": item["leads"],
            "wins": item["wins"],
            "closed": item["closed"],
            "win_rate": (round(item["wins"] / item["closed"] * 100, 1) if item["closed"] else None),
        }
        for item in data
    ]


def build_analytics_chart(
    queryset: QuerySet[Issue],
    x_axis: str,
    group_by: Optional[str] = None,
    date_filter: Optional[str] = None,
    allowed_custom_field_ids: Optional[Set[uuid.UUID]] = None,
) -> Dict[str, Union[List[Dict[str, Any]], Dict[str, str]]]:
    queryset, id_field, name_field, additional_filter = resolve_axis_field(
        queryset, x_axis, "cf_x_axis", allowed_custom_field_ids
    )

    group_field = group_name_field = None
    if group_by:
        queryset, group_field, group_name_field, group_additional_filter = resolve_axis_field(
            queryset, group_by, "cf_group_by", allowed_custom_field_ids
        )
        if group_additional_filter:
            queryset = queryset.filter(**group_additional_filter)

    # Apply the x_axis additional filter (native relations only) if present.
    if additional_filter:
        queryset = queryset.filter(**additional_filter)

    aggregate_func = Count("id", distinct=True)

    if group_field:
        response, schema = build_grouped_chart_response(
            queryset,
            id_field,
            name_field,
            group_field,
            group_name_field,
            aggregate_func,
        )
    else:
        response = build_simple_chart_response(queryset, id_field, name_field, aggregate_func)
        schema = {}

    return {"data": response, "schema": schema}
