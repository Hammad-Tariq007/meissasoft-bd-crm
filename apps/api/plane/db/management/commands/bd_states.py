# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Manage a project's work-item states for the custom BD pipeline.

Modes:
  --list   List all workspaces/projects and, for the target project, its
           current states (name, group, sequence, default). Read-only.
  --apply  Make the target project's (non-triage) states exactly the BD
           pipeline below, idempotently: create missing, update existing by
           name, set "Applied" as the only default, and soft-delete leftover
           states not in the list (default cleared first so deletion is allowed).
           Triage states (system/intake) are preserved untouched.

Target the project with:
  --project "<workspace-slug>/<project-identifier>"   e.g. "bd-leads/ID"
  --project-id "<project-uuid>"
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import Project, State, Workspace

# (name, group, is_default) in the exact desired order.
DESIRED_STATES = [
    ("Applied", "backlog", True),
    ("Client Responded", "unstarted", False),
    ("HR/Discovery Call", "started", False),
    ("CTO/CEO Call", "started", False),
    ("Estimation Sent", "started", False),
    ("Negotiation", "started", False),
    ("Client Still Looking", "unstarted", False),
    ("Won", "completed", False),
    ("Lost", "cancelled", False),
    ("No Response", "cancelled", False),
    ("Disqualified", "cancelled", False),
]

# Color used only when creating a new state (existing states keep their color).
COLOR_BY_GROUP = {
    "backlog": "#60646C",
    "unstarted": "#3F76FF",
    "started": "#F59E0B",
    "completed": "#46A758",
    "cancelled": "#EF4444",
}

SEQUENCE_STEP = 15000


class Command(BaseCommand):
    help = "List or apply the custom BD pipeline work-item states for a project."

    def add_arguments(self, parser):
        parser.add_argument("--list", action="store_true", help="List workspaces/projects and current states.")
        parser.add_argument("--apply", action="store_true", help="Apply the BD pipeline states to the target project.")
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
                '--project "<slug>/<identifier>" or --project-id <uuid> to see its states.'
            )
            return
        self._print_states(project, title="Current states")

    # -------------------------------------------------------------------- apply
    def _handle_apply(self, options):
        project = self._resolve_project(options, required=True)

        self._print_states(project, title="BEFORE — current states")

        created, updated, deleted = [], [], []
        with transaction.atomic():
            name_to_pk = {}
            for index, (name, group, is_default) in enumerate(DESIRED_STATES):
                sequence = (index + 1) * SEQUENCE_STEP
                existing = State.objects.filter(project=project, name__iexact=name).first()
                if existing:
                    existing.name = name
                    existing.group = group
                    existing.sequence = sequence
                    existing.default = is_default
                    existing.is_triage = False
                    existing.save()
                    name_to_pk[name] = existing.pk
                    updated.append(name)
                else:
                    state = State(
                        project=project,
                        name=name,
                        group=group,
                        color=COLOR_BY_GROUP[group],
                        sequence=sequence,
                        default=is_default,
                        is_triage=False,
                    )
                    state.save()  # save() auto-sets workspace and may auto-bump sequence
                    name_to_pk[name] = state.pk
                    created.append(name)

            # Force exact sequence/group/default (save() auto-bumps sequence on create).
            for index, (name, group, is_default) in enumerate(DESIRED_STATES):
                State.all_state_objects.filter(pk=name_to_pk[name]).update(
                    sequence=(index + 1) * SEQUENCE_STEP, group=group, default=is_default
                )

            applied_pk = name_to_pk["Applied"]
            # "Applied" is the only default; clear it everywhere else first so any
            # leftover that was the default can be deleted.
            State.objects.filter(project=project).exclude(pk=applied_pk).update(default=False)
            State.all_state_objects.filter(pk=applied_pk).update(default=True)

            # Soft-delete leftover non-triage states not in the desired list.
            leftovers = list(State.objects.filter(project=project).exclude(pk__in=name_to_pk.values()))
            for state in leftovers:
                deleted.append(state.name)
                state.delete()  # soft delete (sets deleted_at)

        self.stdout.write(self.style.SUCCESS("\nApplied BD pipeline."))
        self.stdout.write(f"  created: {created or '—'}")
        self.stdout.write(f"  updated: {updated or '—'}")
        self.stdout.write(f"  deleted (soft): {deleted or '—'}")
        self._print_states(project, title="AFTER — states now")

    # ------------------------------------------------------------------- helper
    def _print_states(self, project, title):
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\n{title} — {project.name} [identifier: {project.identifier}] "
                f"workspace: {project.workspace.slug} id={project.id}"
            )
        )
        states = State.objects.filter(project=project).order_by("sequence", "name")  # excludes triage
        if not states:
            self.stdout.write("  (no states)")
        else:
            header = f"  {'NAME':<22} {'GROUP':<12} {'SEQUENCE':>10} {'DEFAULT':>8}"
            self.stdout.write(header)
            self.stdout.write("  " + "-" * (len(header) - 2))
            for state in states:
                self.stdout.write(
                    f"  {state.name[:22]:<22} {state.group:<12} {state.sequence:>10.0f} "
                    f"{('yes' if state.default else 'no'):>8}"
                )
        triage = State.triage_objects.filter(project=project).count()
        if triage:
            self.stdout.write(f"  (+ {triage} triage state(s), preserved, not shown)")
