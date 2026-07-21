# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
BD CRM Phase 3 — CI coverage guard for per-profile lead visibility.

The visibility rule (a restricted BD sees only leads whose Profile is assigned to them)
is only as safe as its WEAKEST unscoped path. A single new list/detail endpoint that
builds an ``Issue`` queryset and returns it without routing through
``plane.utils.bd_visibility`` is a data leak.

This test is a STRUCTURAL guard, not a string grep. It parses every view module under
``plane/app/views`` and ``plane/api/views`` into an AST and, for each read entrypoint
(``get`` / ``list`` / ``retrieve`` / ``get_queryset`` / ``base_queryset``), determines:

  1. Does the method build a *top-level* ``Issue`` queryset — i.e. ``Issue.objects`` /
     ``Issue.issue_objects`` used OUTSIDE a ``Subquery`` / ``Exists`` / annotation
     context (those are aggregate sub-selects, not the returned rows)?
  2. If so, is that path *scoped* — does the method (or, for list/retrieve that defer to
     ``get_queryset``, its class's ``get_queryset``) reference ``bd_vis`` scoping?

Every method that builds a returned ``Issue`` queryset but is NOT scoped must appear in
``ALLOWLIST`` with a written reason. A brand-new unscoped issue endpoint therefore fails
this test until its author either scopes it or consciously allowlists it. The allowlist is
compared for EXACT equality, so a path that later becomes scoped (or is deleted) also fails
until the stale entry is removed — the guard can't silently rot.
"""

import ast
import pathlib

import pytest

# Repo root: .../apps/api
API_ROOT = pathlib.Path(__file__).resolve().parents[4]
VIEW_DIRS = [
    API_ROOT / "plane" / "app" / "views",
    API_ROOT / "plane" / "api" / "views",
]

# Read entrypoints that hand a queryset (or a fetched object) to a client.
READ_METHODS = {"get", "list", "retrieve", "get_queryset", "base_queryset"}

# The module alias every scoped path imports the rule under.
SCOPE_MODULE_ALIASES = {"bd_vis", "bd_visibility"}

# Calls that constitute "this path is scoped" when invoked on the alias above.
SCOPE_CALLS = {
    "scope_project_issues",
    "scope_workspace_issues",
    "scope_intake_issues",
    "restricted_issue_q",
    "filter_issue_notifications",
    "filter_issue_entity_rows",
    "is_issue_visible",
}

# Nodes whose subtree is an aggregate sub-select, NOT the returned rows.
SUBQUERY_FUNCS = {"Subquery", "Exists"}

# Models that hydrate an issue (lead) into a client response by (kind, entity_identifier) —
# i.e. a leak surface the Issue-queryset scan can't see, because the issue is resolved inside
# a serializer, not via an Issue queryset. Any read method touching these must route through
# plane.utils.bd_visibility (filter_issue_entity_rows / filter_issue_notifications).
ENTITY_HYDRATION_MODELS = {"UserRecentVisit", "UserFavorite", "Notification"}

# Paths that build an Issue queryset but are intentionally NOT profile-scoped.
# Key: "<relative module path>::<Class>.<method>". Value: the reason (kept in-code so
# every exception is reviewed in the diff). ADD ONLY WITH JUSTIFICATION.
#
# Two categories only:
#  (a) General (non-BD) ANALYTICS endpoints — they return AGGREGATES (counts, distributions,
#      charts, state metadata), never lead titles/descriptions. The BD-lead analytics surface
#      (plane.utils.bd_insights_core, exposed via BDInsightsEndpoint / BDInsightsAPIEndpoint)
#      is separately admin-gated AND defensively profile-scoped. A restricted BD hitting these
#      general endpoints can at most infer aggregate counts, not lead identity/content.
#      >>> Flagged for product review: if aggregate-count leakage is unacceptable, thread the
#          acting user through and scope these too. <<<
#  (b) WRITE paths that gather Issue ids (never return issue rows to the client).
ALLOWLIST = {
    "plane/app/views/analytic/base.py::AnalyticsEndpoint.get": "(a) aggregate charts + state metadata only",
    "plane/app/views/analytic/base.py::SavedAnalyticEndpoint.get": "(a) aggregate charts only",
    "plane/app/views/analytic/base.py::DefaultAnalyticsEndpoint.get": "(a) aggregate state/issue counts only",
    "plane/app/views/analytic/advance.py::AdvanceAnalyticsChartEndpoint.get": "(a) aggregate chart data only",
    "plane/app/views/analytic/project_analytics.py::ProjectAdvanceAnalyticsChartEndpoint.get": (
        "(a) aggregate chart data only"
    ),
    "plane/api/views/module.py::ModuleIssueListCreateAPIEndpoint.post": (
        "(b) write path: gathers ids from a client-supplied issue list to assign to a module; returns no issue rows"
    ),
    "plane/app/views/notification/base.py::MarkAllReadNotificationViewSet.create": (
        "(b) write path: marks the acting user's own notifications read; gathers own created-issue ids only"
    ),
}

# Read methods over an ENTITY_HYDRATION_MODELS queryset that are intentionally NOT scoped
# (e.g. count-only or non-issue-bearing). Key/value shape matches ALLOWLIST. ADD ONLY WITH
# JUSTIFICATION.
ENTITY_HYDRATION_ALLOWLIST = {}

# Write entrypoints that take CALLER-SUPPLIED issue ids from the request body and return
# issue content via a serializer — the exact shape that let the sub-issue / relation leaks
# slip past the read-only scans. Such a method MUST route the supplied ids through a
# visibility/edit guard (bd_vis.* or can_edit_all_issues / can_bd_edit_lead).
WRITE_ENTRY_METHODS = {"post", "create", "create_module_issues", "create_issue_modules"}
# Serializers that expose issue name/description/metadata to the client.
ISSUE_SERIALIZERS = {
    "IssueSerializer",
    "IssueDetailSerializer",
    "IssueRelationSerializer",
    "RelatedIssueSerializer",
}
# Guard calls (bare Names) that count as "the supplied ids were access-checked" for writes.
WRITE_GUARD_NAMES = {"can_edit_all_issues", "can_bd_edit_lead", "is_issue_visible"}

# Write paths matching the caller-supplied-ids + issue-serializer shape that are intentionally
# unguarded (justify each). ADD ONLY WITH JUSTIFICATION.
CALLER_SUPPLIED_WRITE_ALLOWLIST = {}


def _iter_view_files():
    for base in VIEW_DIRS:
        for path in base.rglob("*.py"):
            if path.name == "__init__.py":
                continue
            yield path


def _build_parent_map(tree):
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    return parents


def _is_issue_base(node):
    """True if ``node`` is ``Issue.objects`` / ``Issue.issue_objects`` / ``Issue.all_objects``
    (all_objects includes soft-deleted/archived rows — it was a prior blind spot)."""
    return (
        isinstance(node, ast.Attribute)
        and node.attr in ("objects", "issue_objects", "all_objects")
        and isinstance(node.value, ast.Name)
        and node.value.id == "Issue"
    )


def _within_subquery_context(node, parents):
    """Walk ancestors: is this Issue reference inside Subquery()/Exists() or an
    annotate()/aggregate() keyword argument (i.e. an aggregate sub-select)?"""
    cur = parents.get(node)
    while cur is not None:
        if isinstance(cur, ast.Call):
            func = cur.func
            name = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                name = func.attr
            if name in SUBQUERY_FUNCS:
                return True
            if name in ("annotate", "aggregate"):
                return True
        cur = parents.get(cur)
    return False


def _builds_returned_issue_qs(method_node, parents):
    """The method constructs an Issue queryset that is NOT purely a sub-select."""
    for node in ast.walk(method_node):
        if _is_issue_base(node) and not _within_subquery_context(node, parents):
            return True
    return False


def _references_scope(method_node):
    """The method references a bd_vis scoping call (or the alias at all)."""
    for node in ast.walk(method_node):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in SCOPE_MODULE_ALIASES and node.attr in SCOPE_CALLS:
                return True
    return False


def _defers_to_get_queryset(method_node):
    """The method calls self.get_queryset()/self.base_queryset()."""
    for node in ast.walk(method_node):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("get_queryset", "base_queryset")
        ):
            return True
    return False


def _chain_has_issue_base(node):
    """Walk the receiver chain of a call/attribute expression; True if it is rooted at
    ``Issue.objects`` / ``Issue.issue_objects`` (so ``Issue...values()`` is caught but
    ``IssueRelation...values_list()`` is not)."""
    cur = node
    while cur is not None:
        if _is_issue_base(cur):
            return True
        if isinstance(cur, ast.Call):
            cur = cur.func
        elif isinstance(cur, ast.Attribute):
            cur = cur.value
        elif isinstance(cur, ast.Subscript):
            cur = cur.value
        else:
            break
    return False


def _projects_rows(func_node, parents):
    """The function materializes issue ROWS for a client — an ``Issue``-rooted ``.values()``
    / ``.values_list()`` projection outside a sub-select. Mutations (``.update()`` /
    ``.create()`` / a single ``.get()``) do not, so this cleanly separates read helpers
    (e.g. a search ``filter_issues``) from write paths that merely touch the Issue table."""
    for node in ast.walk(func_node):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("values", "values_list")
            and _chain_has_issue_base(node)
            and not _within_subquery_context(node, parents)
        ):
            return True
    return False


def _enclosing_class_name(func_node, parents):
    cur = parents.get(func_node)
    while cur is not None:
        if isinstance(cur, ast.ClassDef):
            return cur.name
        cur = parents.get(cur)
    return None


def _collect_unscoped():
    """Return {key: (path, lineno)} for every unscoped issue-returning read path.

    Covers BOTH the standard DRF entrypoints (get/list/retrieve/get_queryset) AND helper
    methods / module-level functions that build an issue queryset and project it to rows —
    so a leak hidden in a ``filter_issues`` helper is caught, not just one in ``get``."""
    unscoped = {}
    for path in _iter_view_files():
        source = path.read_text()
        try:
            tree = ast.parse(source)
        except SyntaxError as exc:  # pragma: no cover - a real syntax error fails elsewhere
            pytest.fail(f"Could not parse {path}: {exc}")
        parents = _build_parent_map(tree)
        rel = path.relative_to(API_ROOT).as_posix()

        # Per-class: is the queryset factory scoped? (covers list/retrieve that defer to it.)
        class_qs_scoped = {}
        for cls in ast.walk(tree):
            if isinstance(cls, ast.ClassDef):
                gq = next(
                    (
                        m
                        for m in cls.body
                        if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))
                        and m.name in ("get_queryset", "base_queryset")
                    ),
                    None,
                )
                class_qs_scoped[cls.name] = bool(gq and _references_scope(gq))

        for func in ast.walk(tree):
            if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not _builds_returned_issue_qs(func, parents):
                continue
            if _references_scope(func):
                continue

            is_read_method = func.name in READ_METHODS
            # "Escapes to a client": a read entrypoint, or a helper that projects issue rows.
            if not (is_read_method or _projects_rows(func, parents)):
                continue

            cls_name = _enclosing_class_name(func, parents)
            # A read entrypoint that only defers to an already-scoped get_queryset is safe.
            if (
                is_read_method
                and _defers_to_get_queryset(func)
                and class_qs_scoped.get(cls_name)
            ):
                continue

            qualname = f"{cls_name}.{func.name}" if cls_name else func.name
            key = f"{rel}::{qualname}"
            unscoped[key] = (rel, func.lineno)
    return unscoped


def _within_correlated_subquery(node, parents):
    """True if the statement containing ``node`` references ``OuterRef`` — i.e. this
    ``<Model>.objects`` is a correlated sub-select (e.g. an ``is_favorite`` Exists annotation
    assigned to a variable), not a returned list read."""
    cur = node
    while cur in parents and not isinstance(parents[cur], (ast.FunctionDef, ast.AsyncFunctionDef)):
        cur = parents[cur]
    for n in ast.walk(cur):
        if isinstance(n, ast.Name) and n.id == "OuterRef":
            return True
    return False


def _queries_entity_hydration_model(func_node, parents):
    """The function references a TOP-LEVEL ``<Model>.objects`` for a model that hydrates an
    issue by entity_identifier (UserRecentVisit / UserFavorite / Notification). References
    inside a Subquery()/Exists()/annotate(), or in a correlated (OuterRef) sub-select, are
    ignored — those are 'is this favorited?' style flags on non-issue entities, not an
    entity-hydrating list read."""
    hits = set()
    for node in ast.walk(func_node):
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "objects"
            and isinstance(node.value, ast.Name)
            and node.value.id in ENTITY_HYDRATION_MODELS
            and not _within_subquery_context(node, parents)
            and not _within_correlated_subquery(node, parents)
        ):
            hits.add(node.value.id)
    return hits


def _collect_unscoped_entity_hydration():
    """Return {key: (path, lineno)} for every READ method that queries an entity-hydration
    model without routing through plane.utils.bd_visibility."""
    unscoped = {}
    for path in _iter_view_files():
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError as exc:  # pragma: no cover
            pytest.fail(f"Could not parse {path}: {exc}")
        parents = _build_parent_map(tree)
        rel = path.relative_to(API_ROOT).as_posix()
        for func in ast.walk(tree):
            if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if func.name not in READ_METHODS:
                continue
            if not _queries_entity_hydration_model(func, parents):
                continue
            if _references_scope(func):
                continue
            cls_name = _enclosing_class_name(func, parents)
            qualname = f"{cls_name}.{func.name}" if cls_name else func.name
            unscoped[f"{rel}::{qualname}"] = (rel, func.lineno)
    return unscoped


def _reads_caller_issue_ids(func_node):
    """The function reads issue ids from the request body — request.data.get("<...issue...>")
    or request.data["<...issue...>"]. This is the caller-supplied-ids signal."""
    for node in ast.walk(func_node):
        key = None
        # request.data.get("issues"/"sub_issue_ids"/...)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and isinstance(node.func.value, ast.Attribute)
            and node.func.value.attr == "data"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            key = node.args[0].value
        # request.data["issues"]
        elif (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Attribute)
            and node.value.attr == "data"
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            key = node.slice.value
        if key and "issue" in key.lower():
            return True
    return False


def _within_json_dumps(node, parents):
    """True if ``node`` is nested inside a ``json.dumps(...)`` call — the standard activity-
    tracking `current_instance=json.dumps(IssueSerializer(issue).data)` pattern, which is NOT
    returned to the client and must not count as a response serializer."""
    cur = parents.get(node)
    while cur is not None:
        if (
            isinstance(cur, ast.Call)
            and isinstance(cur.func, ast.Attribute)
            and cur.func.attr == "dumps"
        ):
            return True
        cur = parents.get(cur)
    return False


def _returns_issue_serializer(func_node, parents):
    """The function instantiates an issue/relation serializer that reaches the CLIENT (exposes
    name/description/meta). Serializers used only for activity-tracking (inside json.dumps) do
    not count."""
    for node in ast.walk(func_node):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in ISSUE_SERIALIZERS
            and not _within_json_dumps(node, parents)
        ):
            return True
    return False


def _references_write_guard(func_node):
    """True if the function access-checks the supplied ids: a bd_vis.* scope call, or a bare
    can_edit_all_issues / can_bd_edit_lead / is_issue_visible call."""
    if _references_scope(func_node):
        return True
    for node in ast.walk(func_node):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in WRITE_GUARD_NAMES:
            return True
    return False


def _collect_unguarded_caller_supplied_writes():
    """Return {key: (path, lineno)} for every WRITE entrypoint that takes caller-supplied issue
    ids AND returns issue content via a serializer WITHOUT an access guard — the sub-issue /
    relation leak shape."""
    unguarded = {}
    for path in _iter_view_files():
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError as exc:  # pragma: no cover
            pytest.fail(f"Could not parse {path}: {exc}")
        parents = _build_parent_map(tree)
        rel = path.relative_to(API_ROOT).as_posix()
        for func in ast.walk(tree):
            if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if func.name not in WRITE_ENTRY_METHODS:
                continue
            if not (_reads_caller_issue_ids(func) and _returns_issue_serializer(func, parents)):
                continue
            if _references_write_guard(func):
                continue
            cls_name = _enclosing_class_name(func, parents)
            qualname = f"{cls_name}.{func.name}" if cls_name else func.name
            unguarded[f"{rel}::{qualname}"] = (rel, func.lineno)
    return unguarded


@pytest.mark.unit
class TestBDVisibilityCoverage:
    """Fail CI when a read endpoint returns Issue data without profile scoping."""

    def test_sanity_scanner_detects_an_unscoped_endpoint(self, tmp_path):
        """The scanner must actually catch an unscoped issue list — guard against the
        detector silently degrading to a no-op (e.g. AST shape changes)."""
        sample = tmp_path / "leaky_view.py"
        sample.write_text(
            "from plane.db.models import Issue\n"
            "class LeakyEndpoint:\n"
            "    def get(self, request, slug, project_id):\n"
            "        return Issue.issue_objects.filter(workspace__slug=slug)\n"
        )
        tree = ast.parse(sample.read_text())
        parents = _build_parent_map(tree)
        method = tree.body[1].body[0]
        assert _builds_returned_issue_qs(method, parents) is True
        assert _references_scope(method) is False

    def test_sanity_scanner_ignores_subquery_only_usage(self, tmp_path):
        """An Issue reference used only inside Subquery()/annotate() is an aggregate,
        not a returned queryset, and must NOT be flagged (false-positive guard)."""
        sample = tmp_path / "annotated_view.py"
        sample.write_text(
            "from plane.db.models import Issue, ModuleIssue\n"
            "from django.db.models import Subquery, OuterRef, Func, F\n"
            "class AnnotatedEndpoint:\n"
            "    def get_queryset(self):\n"
            "        return ModuleIssue.objects.annotate(\n"
            "            sub=Subquery(Issue.issue_objects.filter(parent=OuterRef('id')).values('id'))\n"
            "        )\n"
        )
        tree = ast.parse(sample.read_text())
        parents = _build_parent_map(tree)
        method = tree.body[2].body[0]
        assert _builds_returned_issue_qs(method, parents) is False

    def test_no_unscoped_issue_read_endpoints(self):
        """Every read endpoint that returns Issue data is either scoped through
        plane.utils.bd_visibility or explicitly allowlisted with a reason."""
        unscoped = _collect_unscoped()
        offenders = sorted(set(unscoped) - set(ALLOWLIST))
        stale = sorted(set(ALLOWLIST) - set(unscoped))

        assert not offenders, (
            "Unscoped Issue-returning read endpoint(s) detected — route these through "
            "plane.utils.bd_visibility (scope_project_issues / scope_workspace_issues / "
            "is_issue_visible) or, if genuinely safe, add to ALLOWLIST with a reason:\n"
            + "\n".join(f"  - {k} ({unscoped[k][0]}:{unscoped[k][1]})" for k in offenders)
        )
        assert not stale, (
            "ALLOWLIST entries no longer match an unscoped endpoint (now scoped or removed) "
            "— delete the stale entries so the guard stays honest:\n"
            + "\n".join(f"  - {k}" for k in stale)
        )

    def test_sanity_entity_hydration_scanner_detects_unscoped(self, tmp_path):
        """The entity-hydration scanner must catch an unscoped recents/favorites-style read."""
        sample = tmp_path / "leaky_recents.py"
        sample.write_text(
            "from plane.db.models import UserRecentVisit\n"
            "class LeakyRecents:\n"
            "    def list(self, request, slug):\n"
            "        return UserRecentVisit.objects.filter(workspace__slug=slug)\n"
        )
        tree = ast.parse(sample.read_text())
        parents = _build_parent_map(tree)
        method = tree.body[1].body[0]
        assert _queries_entity_hydration_model(method, parents) == {"UserRecentVisit"}
        assert _references_scope(method) is False

    def test_no_unscoped_entity_hydration_reads(self):
        """Every read method touching an entity-hydration model (UserRecentVisit /
        UserFavorite / Notification) routes through plane.utils.bd_visibility or is
        allowlisted — closes the class of leak the Issue-queryset scan can't see."""
        unscoped = _collect_unscoped_entity_hydration()
        offenders = sorted(set(unscoped) - set(ENTITY_HYDRATION_ALLOWLIST))
        stale = sorted(set(ENTITY_HYDRATION_ALLOWLIST) - set(unscoped))

        assert not offenders, (
            "Read method(s) hydrate an issue by entity_identifier without profile scoping — "
            "route through plane.utils.bd_visibility.filter_issue_entity_rows (or "
            "filter_issue_notifications), or add to ENTITY_HYDRATION_ALLOWLIST with a reason:\n"
            + "\n".join(f"  - {k} ({unscoped[k][0]}:{unscoped[k][1]})" for k in offenders)
        )
        assert not stale, (
            "ENTITY_HYDRATION_ALLOWLIST entries no longer match an unscoped read — remove them:\n"
            + "\n".join(f"  - {k}" for k in stale)
        )

    def test_sanity_write_scanner_detects_caller_supplied_leak(self, tmp_path):
        """The write-path scanner must catch the sub-issue / relation leak shape: a post/create
        that reads issue ids from the body and returns an issue serializer with no guard."""
        sample = tmp_path / "leaky_write.py"
        sample.write_text(
            "from plane.db.models import Issue\n"
            "from plane.app.serializers import IssueSerializer\n"
            "class LeakyWrite:\n"
            "    def post(self, request, slug, project_id, issue_id):\n"
            "        ids = request.data.get('sub_issue_ids', [])\n"
            "        qs = Issue.issue_objects.filter(id__in=ids)\n"
            "        return IssueSerializer(qs, many=True).data\n"
        )
        tree = ast.parse(sample.read_text())
        method = tree.body[2].body[0]
        assert _reads_caller_issue_ids(method) is True
        assert _returns_issue_serializer(method, _build_parent_map(tree)) is True
        assert _references_write_guard(method) is False

    def test_sanity_write_scanner_clears_guarded(self, tmp_path):
        """A guarded write (is_issue_visible check) must NOT be flagged (false-positive guard)."""
        sample = tmp_path / "guarded_write.py"
        sample.write_text(
            "from plane.db.models import Issue\n"
            "from plane.app.serializers import IssueSerializer\n"
            "from plane.utils import bd_visibility as bd_vis\n"
            "class GuardedWrite:\n"
            "    def post(self, request, slug, project_id, issue_id):\n"
            "        ids = request.data.get('sub_issue_ids', [])\n"
            "        for i in ids:\n"
            "            if not bd_vis.is_issue_visible(request.user, slug, project_id, i):\n"
            "                return None\n"
            "        return IssueSerializer(Issue.issue_objects.filter(id__in=ids), many=True).data\n"
        )
        tree = ast.parse(sample.read_text())
        method = tree.body[3].body[0]
        assert _reads_caller_issue_ids(method) is True
        assert _references_write_guard(method) is True

    def test_no_unguarded_caller_supplied_issue_writes(self):
        """Every write entrypoint that takes caller-supplied issue ids and returns an issue
        serializer must access-check those ids (bd_vis / can_edit_all_issues / can_bd_edit_lead)
        — closes the sub-issue / relation leak class that the read-only scans miss."""
        unguarded = _collect_unguarded_caller_supplied_writes()
        offenders = sorted(set(unguarded) - set(CALLER_SUPPLIED_WRITE_ALLOWLIST))
        stale = sorted(set(CALLER_SUPPLIED_WRITE_ALLOWLIST) - set(unguarded))

        assert not offenders, (
            "Write endpoint(s) accept caller-supplied issue ids and return issue content with "
            "no visibility/edit guard — validate every supplied id via bd_vis.is_issue_visible "
            "(or can_edit_all_issues / can_bd_edit_lead), or add to CALLER_SUPPLIED_WRITE_ALLOWLIST "
            "with a reason:\n"
            + "\n".join(f"  - {k} ({unguarded[k][0]}:{unguarded[k][1]})" for k in offenders)
        )
        assert not stale, (
            "CALLER_SUPPLIED_WRITE_ALLOWLIST entries no longer match an unguarded write — remove them:\n"
            + "\n".join(f"  - {k}" for k in stale)
        )
