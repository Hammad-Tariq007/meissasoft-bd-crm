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
    "is_issue_visible",
}

# Nodes whose subtree is an aggregate sub-select, NOT the returned rows.
SUBQUERY_FUNCS = {"Subquery", "Exists"}

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
    """True if ``node`` is ``Issue.objects`` or ``Issue.issue_objects``."""
    return (
        isinstance(node, ast.Attribute)
        and node.attr in ("objects", "issue_objects")
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
