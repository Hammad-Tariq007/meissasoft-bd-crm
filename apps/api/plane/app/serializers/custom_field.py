# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from plane.db.models import (
    CustomFieldDefinition,
    CustomFieldOption,
    CustomFieldType,
    CustomFieldValue,
)


class CustomFieldOptionSerializer(BaseSerializer):
    class Meta:
        model = CustomFieldOption
        fields = [
            "id",
            "field",
            "project_id",
            "workspace_id",
            "name",
            "color",
            "sequence",
            "is_active",
        ]
        read_only_fields = ["workspace", "project", "field"]


class CustomFieldDefinitionSerializer(BaseSerializer):
    options = CustomFieldOptionSerializer(many=True, read_only=True)

    class Meta:
        model = CustomFieldDefinition
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "key",
            "description",
            "field_type",
            "is_required",
            "is_active",
            "sequence",
            "settings",
            "options",
        ]
        read_only_fields = ["workspace", "project", "key"]


class CustomFieldValueSerializer(BaseSerializer):
    """Read serializer for a work item's custom field value.

    Writing is handled imperatively in the view (type-aware upsert), so all
    fields here are read-only. ``value`` is the canonical value for the field's
    type; the raw typed columns are also exposed for clients that prefer them.
    """

    field_type = serializers.CharField(source="field.field_type", read_only=True)
    value = serializers.SerializerMethodField()

    class Meta:
        model = CustomFieldValue
        fields = [
            "id",
            "field",
            "field_type",
            "issue",
            "project_id",
            "workspace_id",
            "value",
            "value_text",
            "value_number",
            "value_date",
            "value_boolean",
            "value_option",
            "value_options",
            "value_member",
        ]
        read_only_fields = fields

    def get_value(self, obj):
        field_type = obj.field.field_type
        if field_type in (CustomFieldType.TEXT, CustomFieldType.LONG_TEXT, CustomFieldType.URL):
            return obj.value_text
        if field_type == CustomFieldType.NUMBER:
            return obj.value_number
        if field_type == CustomFieldType.DATE:
            return obj.value_date
        if field_type == CustomFieldType.CHECKBOX:
            return obj.value_boolean
        if field_type == CustomFieldType.SINGLE_SELECT:
            return obj.value_option_id
        if field_type == CustomFieldType.MULTI_SELECT:
            return [option.id for option in obj.value_options.all()]
        if field_type == CustomFieldType.MEMBER:
            return obj.value_member_id
        return None
