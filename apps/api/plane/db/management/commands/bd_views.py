# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Seed a project's saved Views (IssueView) for the BD leads workflow.

Modes:
  --list   List all workspaces/projects and, for the target project, its
           current saved views (name, layout, group_by, order_by, filter
           summary). Read-only.
  --apply  Seed the DESIRED_VIEWS below into the target project, idempotently:
             - match existing views by name (case-insensitive) and update the
               filters / display settings in place — never duplicate;
             - create views that are missing;
             - force the exact order via sort_order.
           State-based filters are built from the project's REAL State ids,
           looked up by name at run time. Views already on the project that are
           not in the list are left untouched (not deleted). Existing views keep
           their owner and column choices (display_properties); new views get a
           resolved owner and the default columns.

Target the project with:
  --project "<workspace-slug>/<project-identifier>"   e.g. "bd-leads/ID"
  --project-id "<project-uuid>"
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import IssueView, Project, ProjectMember, State, Workspace
from plane.db.models.view import get_default_display_filters, get_default_display_properties

SORT_ORDER_STEP = 10000

# Leads that are still "open" — everything except the terminal outcome states.
OPEN_STATES = [
    "Applied",
    "Client Responded",
    "HR/Discovery Call",
    "CTO/CEO Call",
    "Estimation Sent",
    "Negotiation",
    "Client Still Looking",
]
# Terminal "we lost / dropped it" states.
LOSS_STATES = ["Lost", "No Response", "Disqualified"]

# Desired saved views, in display order. `states` lists State NAMES (resolved to
# ids at run time); None means "no state filter". display settings are applied on
# top of the model defaults.
#   layout:    "list" | "spreadsheet"
#   group_by:  "state" | None
#   order_by:  "sort_order" | "updated_at" (oldest-first) | "-created_at" | "-updated_at"
DESIRED_VIEWS = [
    {
        "name": "Active Pipeline",
        "description": "All open leads, grouped by pipeline stage.",
        "states": OPEN_STATES,
        "layout": "list",
        "group_by": "state",
        "order_by": "sort_order",
    },
    {
        "name": "Closing Soon",
        "description": "Leads in Estimation Sent or Negotiation — closest to a decision.",
        "states": ["Estimation Sent", "Negotiation"],
        "layout": "list",
        "group_by": "state",
        "order_by": "sort_order",
    },
    {
        "name": "Follow-up Queue",
        "description": "Open leads ordered oldest-updated first — the stalest sit at the top.",
        "states": OPEN_STATES,
        "layout": "spreadsheet",
        "group_by": None,
        "order_by": "updated_at",  # ascending -> oldest updated first
    },
    {
        "name": "New / Applied",
        "description": "Leads still in the Applied stage.",
        "states": ["Applied"],
        "layout": "list",
        "group_by": None,
        "order_by": "-created_at",  # newest applications first
    },
    {
        "name": "Loss Autopsy",
        "description": "Lost, No Response and Disqualified leads — for review.",
        "states": LOSS_STATES,
        "layout": "list",
        "group_by": "state",
        "order_by": "-updated_at",
    },
    {
        "name": "Won Deals",
        "description": "Leads we won.",
        "states": ["Won"],
        "layout": "spreadsheet",
        "group_by": None,
        "order_by": "-updated_at",  # most recently won first
    },
    {
        "name": "All Leads",
        "description": "Every lead, no filter.",
        "states": None,
        "layout": "spreadsheet",
        "group_by": None,
        "order_by": "-created_at",
    },
]


class Command(BaseCommand):
    help = "List or seed the BD leads saved views for a project."

    def add_arguments(self, parser):
        parser.add_argument("--list", action="store_true", help="List workspaces/projects and current views.")
        parser.add_argument("--apply", action="store_true", help="Seed the BD views into the target project.")
        parser.add_argument("--project", help='Target project as "<workspace-slug>/<project-identifier>".')
        parser.add_argument("--project-id", dest="project_id", help="Target project UUID.")

    def handle(self, *args, **options):
        do_list = options["list"]
        do_apply = options["apply"]
        if do_list == do_apply:  # both or neither
            raise CommandError("Specify exactly one mode: --list or --apply.")

        if do_list:
            self._handle_list(options)
        else:
            self._handle_apply(options)

    # ------------------------------------------------------------------ resolve
    def _resolve_project(self, options, required):
        project_id = options.get("project_id")
        project_ref = options.get("project")

        project = None
        if project_id:
            project = Project.objects.select_related("workspace").filter(id=project_id).first()
            if not project:
                raise CommandError(f"No project with id '{project_id}'.")
        elif project_ref:
            if "/" not in project_ref:
                raise CommandError('--project must be "<workspace-slug>/<project-identifier>".')
            slug, identifier = project_ref.split("/", 1)
            matches = list(
                Project.objects.select_related("workspace").filter(
                    workspace__slug=slug.strip(), identifier__iexact=identifier.strip()
                )
            )
            if not matches:
                raise CommandError(f"No project '{identifier}' in workspace '{slug}'.")
            if len(matches) > 1:
                raise CommandError(f"'{project_ref}' is ambiguous ({len(matches)} matches); use --project-id.")
            project = matches[0]

        if project is None and required:
            raise CommandError("A target project is required. Pass --project or --project-id.")
        return project

    def _resolve_owner(self, project):
        """Pick a stable owner for newly created views: the project lead if set,
        otherwise the highest-role active project member (tie-break: earliest)."""
        if getattr(project, "project_lead_id", None):
            return project.project_lead_id
        member = (
            ProjectMember.objects.filter(project=project, is_active=True)
            .order_by("-role", "created_at")
            .first()
        )
        if not member:
            raise CommandError(f"No active members on project '{project.name}' to own the views.")
        return member.member_id

    def _resolve_state_ids(self, project, names):
        """Map a list of state NAMES to this project's real State ids, preserving
        the given order. Raises if any referenced state is missing."""
        by_name = {s.name.lower(): s for s in State.objects.filter(project=project)}
        ids, missing = [], []
        for name in names:
            state = by_name.get(name.lower())
            if state:
                ids.append(str(state.id))
            else:
                missing.append(name)
        if missing:
            raise CommandError(
                f"Project '{project.name}' is missing required state(s): {missing}. "
                "Run bd_states --apply first."
            )
        return ids

    # --------------------------------------------------------------------- list
    def _handle_list(self, options):
        self.stdout.write(self.style.MIGRATE_HEADING("Workspaces and projects:"))
        for workspace in Workspace.objects.order_by("slug"):
            self.stdout.write(f"\n  Workspace: {workspace.name}  (slug: {workspace.slug})")
            projects = Project.objects.filter(workspace=workspace).order_by("name")
            if not projects:
                self.stdout.write("    (no projects)")
            for project in projects:
                self.stdout.write(f"    - {project.name}  [identifier: {project.identifier}]  id={project.id}")

        project = self._resolve_project(options, required=False)
        if project is None:
            self.stdout.write(
                "\nNo target project resolved. Re-run with "
                '--project "<slug>/<identifier>" or --project-id <uuid> to see its views.'
            )
            return
        self._print_views(project, title="Current views")

    # -------------------------------------------------------------------- apply
    def _handle_apply(self, options):
        project = self._resolve_project(options, required=True)

        self._print_views(project, title="BEFORE — current views")

        owner_id = self._resolve_owner(project)
        created, updated = [], []
        with transaction.atomic():
            for index, spec in enumerate(DESIRED_VIEWS):
                sort_order = (index + 1) * SORT_ORDER_STEP

                # Build the filters dict (source of truth; save() derives `query`).
                filters = {}
                if spec["states"]:
                    filters["state"] = self._resolve_state_ids(project, spec["states"])

                display_filters = get_default_display_filters()
                display_filters.update(
                    {"layout": spec["layout"], "group_by": spec["group_by"], "order_by": spec["order_by"]}
                )

                existing = IssueView.objects.filter(project=project, name__iexact=spec["name"]).first()
                if existing:
                    existing.name = spec["name"]
                    existing.description = spec["description"]
                    existing.filters = filters
                    existing.display_filters = display_filters
                    existing.access = 1  # Public
                    existing.save()  # recomputes query from filters; keeps owner & columns
                    view = existing
                    updated.append(spec["name"])
                else:
                    view = IssueView(
                        workspace=project.workspace,
                        project=project,
                        name=spec["name"],
                        description=spec["description"],
                        filters=filters,
                        display_filters=display_filters,
                        display_properties=get_default_display_properties(),
                        access=1,  # Public
                        owned_by_id=owner_id,
                    )
                    view.save()  # save() derives query and may auto-bump sort_order
                    created.append(spec["name"])

                # Force the exact ordering (save() auto-bumps sort_order on create).
                IssueView.objects.filter(pk=view.pk).update(sort_order=sort_order)

        self.stdout.write(self.style.SUCCESS("\nSeeded BD views."))
        self.stdout.write(f"  created: {created or '—'}")
        self.stdout.write(f"  updated: {updated or '—'}")
        self._print_views(project, title="AFTER — views now")

    # ------------------------------------------------------------------- helper
    def _print_views(self, project, title):
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\n{title} — {project.name} [identifier: {project.identifier}] "
                f"workspace: {project.workspace.slug} id={project.id}"
            )
        )
        views = IssueView.objects.filter(project=project).order_by("sort_order", "name")
        if not views:
            self.stdout.write("  (no views)")
            return
        # id -> name so state-id filters read as names.
        state_name = {str(s.id): s.name for s in State.objects.filter(project=project)}
        header = f"  {'NAME':<18} {'LAYOUT':<12} {'GROUP BY':<10} {'ORDER BY':<12} FILTER"
        self.stdout.write(header)
        self.stdout.write("  " + "-" * (len(header) - 2))
        for view in views:
            df = view.display_filters or {}
            states = (view.filters or {}).get("state") or []
            if states:
                names = ", ".join(state_name.get(str(sid), str(sid)) for sid in states)
                filter_summary = f"state in [{names}]"
            else:
                filter_summary = "(none)"
            self.stdout.write(
                f"  {view.name[:18]:<18} {str(df.get('layout')):<12} "
                f"{str(df.get('group_by')):<10} {str(df.get('order_by')):<12} {filter_summary}"
            )
