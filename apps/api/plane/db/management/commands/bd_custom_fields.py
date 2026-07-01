# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Seed a project's custom fields for the BD leads workflow.

Modes:
  --list   List all workspaces/projects and, for the target project, its
           current custom fields (name, type, required, active, sequence,
           option count). Read-only.
  --apply  Seed the DESIRED_FIELDS below into the target project, idempotently:
             - match existing fields by name (case-insensitive) and update in
               place — never duplicate;
             - create fields that are missing;
             - force the exact order via sequence;
             - for select fields, MERGE options: add any missing option,
               never remove or rename existing ones.
           All fields are seeded with is_required=False. Fields already on the
           project that are not in the list are left untouched (not deleted).

Target the project with:
  --project "<workspace-slug>/<project-identifier>"   e.g. "bd-leads/ID"
  --project-id "<project-uuid>"
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import CustomFieldDefinition, CustomFieldOption, Project, Workspace
from plane.db.models.custom_field import SELECT_TYPES

SEQUENCE_STEP = 15000

# Full ISO 3166-1 country list (UN members + Holy See and State of Palestine),
# sorted alphabetically. The work-item select is searchable, so a long list is fine.
COUNTRIES = sorted(
    [
        "Afghanistan",
        "Albania",
        "Algeria",
        "Andorra",
        "Angola",
        "Antigua and Barbuda",
        "Argentina",
        "Armenia",
        "Australia",
        "Austria",
        "Azerbaijan",
        "Bahamas",
        "Bahrain",
        "Bangladesh",
        "Barbados",
        "Belarus",
        "Belgium",
        "Belize",
        "Benin",
        "Bhutan",
        "Bolivia",
        "Bosnia and Herzegovina",
        "Botswana",
        "Brazil",
        "Brunei",
        "Bulgaria",
        "Burkina Faso",
        "Burundi",
        "Cabo Verde",
        "Cambodia",
        "Cameroon",
        "Canada",
        "Central African Republic",
        "Chad",
        "Chile",
        "China",
        "Colombia",
        "Comoros",
        "Congo (Brazzaville)",
        "Congo (Kinshasa)",
        "Costa Rica",
        "Côte d'Ivoire",
        "Croatia",
        "Cuba",
        "Cyprus",
        "Czechia",
        "Denmark",
        "Djibouti",
        "Dominica",
        "Dominican Republic",
        "Ecuador",
        "Egypt",
        "El Salvador",
        "Equatorial Guinea",
        "Eritrea",
        "Estonia",
        "Eswatini",
        "Ethiopia",
        "Fiji",
        "Finland",
        "France",
        "Gabon",
        "Gambia",
        "Georgia",
        "Germany",
        "Ghana",
        "Greece",
        "Grenada",
        "Guatemala",
        "Guinea",
        "Guinea-Bissau",
        "Guyana",
        "Haiti",
        "Holy See",
        "Honduras",
        "Hungary",
        "Iceland",
        "India",
        "Indonesia",
        "Iran",
        "Iraq",
        "Ireland",
        "Israel",
        "Italy",
        "Jamaica",
        "Japan",
        "Jordan",
        "Kazakhstan",
        "Kenya",
        "Kiribati",
        "Kuwait",
        "Kyrgyzstan",
        "Laos",
        "Latvia",
        "Lebanon",
        "Lesotho",
        "Liberia",
        "Libya",
        "Liechtenstein",
        "Lithuania",
        "Luxembourg",
        "Madagascar",
        "Malawi",
        "Malaysia",
        "Maldives",
        "Mali",
        "Malta",
        "Marshall Islands",
        "Mauritania",
        "Mauritius",
        "Mexico",
        "Micronesia",
        "Moldova",
        "Monaco",
        "Mongolia",
        "Montenegro",
        "Morocco",
        "Mozambique",
        "Myanmar",
        "Namibia",
        "Nauru",
        "Nepal",
        "Netherlands",
        "New Zealand",
        "Nicaragua",
        "Niger",
        "Nigeria",
        "North Korea",
        "North Macedonia",
        "Norway",
        "Oman",
        "Pakistan",
        "Palau",
        "Palestine",
        "Panama",
        "Papua New Guinea",
        "Paraguay",
        "Peru",
        "Philippines",
        "Poland",
        "Portugal",
        "Qatar",
        "Romania",
        "Russia",
        "Rwanda",
        "Saint Kitts and Nevis",
        "Saint Lucia",
        "Saint Vincent and the Grenadines",
        "Samoa",
        "San Marino",
        "Sao Tome and Principe",
        "Saudi Arabia",
        "Senegal",
        "Serbia",
        "Seychelles",
        "Sierra Leone",
        "Singapore",
        "Slovakia",
        "Slovenia",
        "Solomon Islands",
        "Somalia",
        "South Africa",
        "South Korea",
        "South Sudan",
        "Spain",
        "Sri Lanka",
        "Sudan",
        "Suriname",
        "Sweden",
        "Switzerland",
        "Syria",
        "Tajikistan",
        "Tanzania",
        "Thailand",
        "Timor-Leste",
        "Togo",
        "Tonga",
        "Trinidad and Tobago",
        "Tunisia",
        "Türkiye",
        "Turkmenistan",
        "Tuvalu",
        "Uganda",
        "Ukraine",
        "United Arab Emirates",
        "United Kingdom",
        "United States",
        "Uruguay",
        "Uzbekistan",
        "Vanuatu",
        "Venezuela",
        "Vietnam",
        "Yemen",
        "Zambia",
        "Zimbabwe",
    ]
)

# (name, field_type, options) in the exact desired order. options is None for
# non-select fields, or a list of option names for select fields.
DESIRED_FIELDS = [
    ("Profile", "single_select", ["Farrukh", "Mohsin", "Umer-Farooq", "Umer-Mirza", "Ali-Hassan", "Hamza"]),
    ("Lead Source", "single_select", ["Applied", "Invited"]),
    ("Country", "single_select", COUNTRIES),
    ("Client Name", "text", None),
    ("Contract Type", "single_select", ["Fixed", "Hourly"]),
    ("Rate", "text", None),
    ("No. of Weeks", "number", None),
    ("Total Connects Spent", "number", None),
    ("Boosted Proposal?", "checkbox", None),
    ("Boost Connects Bid", "number", None),
    ("Upwork Job Link", "url", None),
]


class Command(BaseCommand):
    help = "List or seed the BD leads custom fields for a project."

    def add_arguments(self, parser):
        parser.add_argument("--list", action="store_true", help="List workspaces/projects and current custom fields.")
        parser.add_argument("--apply", action="store_true", help="Seed the BD custom fields into the target project.")
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
                '--project "<slug>/<identifier>" or --project-id <uuid> to see its custom fields.'
            )
            return
        self._print_fields(project, title="Current custom fields")

    # -------------------------------------------------------------------- apply
    def _handle_apply(self, options):
        project = self._resolve_project(options, required=True)

        self._print_fields(project, title="BEFORE — current custom fields")

        created, updated, options_added = [], [], []
        with transaction.atomic():
            for index, (name, field_type, option_names) in enumerate(DESIRED_FIELDS):
                sequence = (index + 1) * SEQUENCE_STEP
                existing = CustomFieldDefinition.objects.filter(project=project, name__iexact=name).first()
                if existing:
                    existing.name = name
                    existing.field_type = field_type
                    existing.is_required = False
                    existing.is_active = True
                    existing.sequence = sequence
                    existing.save()  # keeps the existing key
                    field = existing
                    updated.append(name)
                else:
                    field = CustomFieldDefinition(
                        project=project,
                        name=name,
                        field_type=field_type,
                        is_required=False,
                        is_active=True,
                        sequence=sequence,
                    )
                    field.save()  # save() auto-sets workspace/key and may auto-bump sequence
                    created.append(name)

                # Force the exact ordering (save() auto-bumps sequence on create).
                CustomFieldDefinition.objects.filter(pk=field.pk).update(sequence=sequence)

                # Merge options for select fields: add missing, keep existing.
                if field_type in SELECT_TYPES and option_names:
                    for option_name in option_names:
                        exists = CustomFieldOption.objects.filter(field=field, name__iexact=option_name).exists()
                        if not exists:
                            CustomFieldOption(
                                field=field, project=project, name=option_name, is_active=True
                            ).save()  # sequence auto-bumps to append in list order
                            options_added.append(f"{name} / {option_name}")

        self.stdout.write(self.style.SUCCESS("\nSeeded BD custom fields."))
        self.stdout.write(f"  fields created: {created or '—'}")
        self.stdout.write(f"  fields updated: {updated or '—'}")
        self.stdout.write(f"  options added:  {len(options_added)}")
        if options_added:
            for entry in options_added:
                self.stdout.write(f"    + {entry}")
        self._print_fields(project, title="AFTER — custom fields now")

    # ------------------------------------------------------------------- helper
    def _print_fields(self, project, title):
        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\n{title} — {project.name} [identifier: {project.identifier}] "
                f"workspace: {project.workspace.slug} id={project.id}"
            )
        )
        fields = CustomFieldDefinition.objects.filter(project=project).order_by("sequence", "name")
        if not fields:
            self.stdout.write("  (no custom fields)")
            return
        header = f"  {'NAME':<22} {'TYPE':<15} {'REQ':>4} {'ACTIVE':>7} {'SEQUENCE':>10} {'OPTIONS':>8}"
        self.stdout.write(header)
        self.stdout.write("  " + "-" * (len(header) - 2))
        for field in fields:
            option_count = CustomFieldOption.objects.filter(field=field).count()
            self.stdout.write(
                f"  {field.name[:22]:<22} {field.field_type:<15} "
                f"{('yes' if field.is_required else 'no'):>4} "
                f"{('yes' if field.is_active else 'no'):>7} "
                f"{field.sequence:>10.0f} {option_count:>8}"
            )
