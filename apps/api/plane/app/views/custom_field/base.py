# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseAPIView, BaseViewSet
from plane.app.permissions import (
    ROLE,
    allow_permission,
    can_bd_edit_lead,
    is_issue_assignee,
    is_project_admin,
)
from plane.app.serializers import (
    CustomFieldDefinitionSerializer,
    CustomFieldOptionSerializer,
    CustomFieldValueSerializer,
)
from plane.db.models import (
    CustomFieldDefinition,
    CustomFieldOption,
    CustomFieldType,
    CustomFieldValue,
    Issue,
    WorkspaceMember,
)
from plane.db.models.custom_field import SELECT_TYPES, TEXT_TYPES
from plane.utils import bd_insights_core as bd_core

# Options are reordered/created with this gap, matching the State convention.
SEQUENCE_STEP = 15000


class CustomFieldDefinitionViewSet(BaseViewSet):
    """Project-scoped CRUD for custom field definitions.

    Read: any project member. Write: project admins.
    """

    serializer_class = CustomFieldDefinitionSerializer
    model = CustomFieldDefinition

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .select_related("project", "workspace")
            .prefetch_related("options")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        return Response(
            CustomFieldDefinitionSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, pk):
        field = self.get_queryset().get(pk=pk)
        return Response(CustomFieldDefinitionSerializer(field).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        try:
            serializer = CustomFieldDefinitionSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(project_id=project_id)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "A field with this name already exists in the project."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def partial_update(self, request, slug, project_id, pk):
        try:
            field = CustomFieldDefinition.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
            serializer = CustomFieldDefinitionSerializer(field, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "A field with this name already exists in the project."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, pk):
        field = CustomFieldDefinition.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        # Soft-delete dependents too (FK CASCADE only fires on hard delete).
        with transaction.atomic():
            CustomFieldValue.objects.filter(field=field).delete()
            CustomFieldOption.objects.filter(field=field).delete()
            field.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomFieldOptionViewSet(BaseViewSet):
    """Manage the options of a single_select / multi_select field definition.

    Read: any project member. Write (create/edit/remove/reorder): project admins.
    """

    serializer_class = CustomFieldOptionSerializer
    model = CustomFieldOption

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(field_id=self.kwargs.get("field_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .select_related("field", "project", "workspace")
            .distinct()
        )

    def _get_field(self, slug, project_id, field_id):
        return CustomFieldDefinition.objects.get(pk=field_id, project_id=project_id, workspace__slug=slug)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id, field_id):
        return Response(
            CustomFieldOptionSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id, field_id):
        field = self._get_field(slug, project_id, field_id)
        if field.field_type not in SELECT_TYPES:
            return Response(
                {"error": "Options can only be added to single_select / multi_select fields."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            serializer = CustomFieldOptionSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(project_id=project_id, field_id=field_id)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "An option with this name already exists for the field."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def partial_update(self, request, slug, project_id, field_id, pk):
        try:
            option = CustomFieldOption.objects.get(
                pk=pk, field_id=field_id, project_id=project_id, workspace__slug=slug
            )
            serializer = CustomFieldOptionSerializer(option, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response(
                {"error": "An option with this name already exists for the field."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, field_id, pk):
        option = CustomFieldOption.objects.get(pk=pk, field_id=field_id, project_id=project_id, workspace__slug=slug)
        option.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN])
    def reorder(self, request, slug, project_id, field_id):
        order = request.data.get("options", [])
        if not isinstance(order, list):
            return Response(
                {"error": "options must be a list of option ids in the desired order."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            for index, option_id in enumerate(order):
                CustomFieldOption.objects.filter(
                    pk=option_id, field_id=field_id, project_id=project_id, workspace__slug=slug
                ).update(sequence=(index + 1) * SEQUENCE_STEP)
        return Response(
            CustomFieldOptionSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )


class CustomFieldValueViewSet(BaseViewSet):
    """Read and set custom field values for a single work item.

    list: any project member. set (create=upsert) / clear: admins and members.
    """

    serializer_class = CustomFieldValueSerializer
    model = CustomFieldValue

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .select_related("field", "value_option", "value_member", "project", "workspace")
            .prefetch_related("value_options")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id, issue_id):
        return Response(
            CustomFieldValueSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN], assignee=True, dev_lead=True)
    def create(self, request, slug, project_id, issue_id):
        """Upsert a single field's value on this work item (one row per field+issue)."""
        field_id = request.data.get("field")
        if not field_id:
            return Response({"error": "field is required."}, status=status.HTTP_400_BAD_REQUEST)

        field = CustomFieldDefinition.objects.get(pk=field_id, project_id=project_id, workspace__slug=slug)
        issue = Issue.objects.get(pk=issue_id, project_id=project_id, workspace__slug=slug)
        value = request.data.get("value", None)

        # BD CRM: the decorator's dev_lead grant lets a Dev-team lead reach this view, but it is
        # meant ONLY for the "Assigned Dev" (MEMBER) field — dev-assignment ownership. Field-scope
        # it here: for any OTHER field, a caller must satisfy the ordinary write gate (admin /
        # the lead's assignee / a BD who may edit this lead). A Dev lead with none of those is
        # denied on non-Assigned-Dev fields, so this only ever ADDS access to that one field.
        if field.name != bd_core.ASSIGNED_DEV_FIELD_NAME and not (
            is_project_admin(request.user, slug, project_id)
            or is_issue_assignee(request.user, issue_id)
            or can_bd_edit_lead(request.user, slug, project_id, issue_id)
        ):
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        field_type = field.field_type
        is_multi = field_type == CustomFieldType.MULTI_SELECT
        # False / 0 are real values; only None / "" / [] count as empty.
        is_empty = value is None or value == "" or value == []

        if field.is_required and is_empty:
            return Response({"error": f"'{field.name}' is required."}, status=status.HTTP_400_BAD_REQUEST)

        # BD CRM: Profile write rules for a restricted BD. This is the SOLE custom-field write
        # path (the public /api/v1 API has none), so it covers create AND edit, UI AND API.
        # Fail closed — if the Profile field can't be resolved by name, deny (a rename must
        # block loudly, never silently fall open). NOTE: any future public-API custom-field
        # write MUST call this same guard.
        if bd_core.is_restricted_bd(request.user, slug):
            profile_field_id = bd_core.resolve_profile_field_id(slug, project_id)
            if profile_field_id is None:
                return Response(
                    {"error": "Profile field is misconfigured; lead changes are blocked. Contact an admin."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if str(field.id) == str(profile_field_id):
                # CREATE vs EDIT — non-fragile signal: a Profile value row already existing for
                # this issue means the lead already has a Profile, so this is an EDIT. A
                # restricted BD may set Profile ONLY at creation (no row yet); editing the
                # Profile of an existing lead is admin-only, regardless of target profile.
                profile_already_set = CustomFieldValue.objects.filter(field=field, issue=issue).exists()
                if profile_already_set:
                    return Response(
                        {"error": "Only an admin can change the Profile of an existing lead."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                # CREATE (Phase 2, unchanged): must be a profile assigned to them, not empty.
                if is_empty:
                    return Response(
                        {"error": "As a BD you must set a Profile assigned to you."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                allowed = {str(x) for x in bd_core.assigned_profile_option_ids(request.user, slug, project_id)}
                if str(value) not in allowed:
                    return Response(
                        {"error": "You can only use a profile assigned to you in this project."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        # Reuse the existing value row for this (field, issue) or build a new one.
        obj = CustomFieldValue.objects.filter(field=field, issue=issue).first()
        if obj is None:
            obj = CustomFieldValue(field=field, issue=issue, project_id=project_id)

        # Reset every typed column; we set only the one for this field's type.
        obj.value_text = None
        obj.value_number = None
        obj.value_date = None
        obj.value_boolean = None
        obj.value_option = None
        obj.value_member = None
        option_objs = []

        try:
            if field_type in TEXT_TYPES:  # text / long_text / url
                obj.value_text = value or None
            elif field_type == CustomFieldType.NUMBER:
                obj.value_number = None if is_empty else value
            elif field_type == CustomFieldType.DATE:
                obj.value_date = None if is_empty else value
            elif field_type == CustomFieldType.CHECKBOX:
                obj.value_boolean = None if value is None else bool(value)
            elif field_type == CustomFieldType.SINGLE_SELECT:
                if not is_empty:
                    obj.value_option = CustomFieldOption.objects.get(pk=value, field=field)
            elif field_type == CustomFieldType.MEMBER:
                if not is_empty:
                    if not WorkspaceMember.objects.filter(
                        member_id=value, workspace__slug=slug, is_active=True
                    ).exists():
                        return Response(
                            {"error": "Selected member is not part of this workspace."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    obj.value_member_id = value
            elif is_multi:
                ids = value or []
                if not isinstance(ids, list):
                    return Response(
                        {"error": "Multi-select value must be a list of option ids."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                option_objs = list(CustomFieldOption.objects.filter(pk__in=ids, field=field))
                if len(option_objs) != len(set(str(i) for i in ids)):
                    return Response(
                        {"error": "One or more options do not belong to this field."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
        except CustomFieldOption.DoesNotExist:
            return Response(
                {"error": "Selected option does not belong to this field."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Model-level validation (URL format, option ownership, field coercion).
        # Exclude fields populated on save() (workspace, audit FKs) and the M2M.
        try:
            obj.full_clean(exclude=["workspace", "value_options", "created_by", "updated_by"])
        except DjangoValidationError as error:
            detail = error.message_dict if hasattr(error, "message_dict") else error.messages
            return Response({"error": detail}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            obj.save()  # save() sets workspace from project
            if is_multi:
                obj.value_options.set(option_objs)
            else:
                obj.value_options.clear()

        obj = self.get_queryset().get(pk=obj.pk)
        return Response(CustomFieldValueSerializer(obj).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], assignee=True)
    def clear(self, request, slug, project_id, issue_id, field_id):
        """Remove this work item's value for the given field."""
        # BD CRM Phase 2: a restricted BD cannot clear/empty the Profile field. Fail
        # closed — if the Profile field can't be resolved, deny regardless.
        if bd_core.is_restricted_bd(request.user, slug):
            profile_field_id = bd_core.resolve_profile_field_id(slug, project_id)
            if profile_field_id is None or str(field_id) == str(profile_field_id):
                return Response(
                    {"error": "As a BD you must keep a Profile assigned to you."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        field = CustomFieldDefinition.objects.get(pk=field_id, project_id=project_id, workspace__slug=slug)
        if field.is_required:
            return Response(
                {"error": f"'{field.name}' is required and cannot be cleared."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        obj = CustomFieldValue.objects.filter(
            field_id=field_id, issue_id=issue_id, project_id=project_id
        ).first()
        if obj:
            obj.value_options.clear()  # drop M2M rows before soft-deleting the value
            obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectCustomFieldValuesEndpoint(BaseAPIView):
    """Bulk read of custom field values for many work items in one query.

    Powers the spreadsheet view: one request/one query per page of issues
    instead of one per row. Read-only; any project member. Pass a comma
    separated ``issue_ids`` query param to scope to the visible page.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        queryset = (
            CustomFieldValue.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .select_related("field", "value_option", "value_member")
            .prefetch_related("value_options")
        )
        issue_ids = request.query_params.get("issue_ids")
        if issue_ids:
            queryset = queryset.filter(issue_id__in=[i for i in issue_ids.split(",") if i])
        return Response(
            CustomFieldValueSerializer(queryset.distinct(), many=True).data,
            status=status.HTTP_200_OK,
        )
