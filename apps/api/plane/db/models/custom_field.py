# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.db import models
from django.db.models import Q
from django.template.defaultfilters import slugify

# Module imports
from .project import ProjectBaseModel


class CustomFieldType(models.TextChoices):
    """Field types supported by the custom-fields engine (v1)."""

    TEXT = "text", "Text"
    LONG_TEXT = "long_text", "Long text"
    URL = "url", "URL"
    NUMBER = "number", "Number"
    DATE = "date", "Date"
    CHECKBOX = "checkbox", "Checkbox"
    SINGLE_SELECT = "single_select", "Single select"
    MULTI_SELECT = "multi_select", "Multi select"
    MEMBER = "member", "Member"


# Text-backed types: each is first-class (own type + validation) but shares the
# value_text storage column.
TEXT_TYPES = frozenset({CustomFieldType.TEXT, CustomFieldType.LONG_TEXT, CustomFieldType.URL})
SELECT_TYPES = frozenset({CustomFieldType.SINGLE_SELECT, CustomFieldType.MULTI_SELECT})

# Maps a field type to the CustomFieldValue attribute that stores it.
VALUE_ATTR_BY_TYPE = {
    CustomFieldType.TEXT: "value_text",
    CustomFieldType.LONG_TEXT: "value_text",
    CustomFieldType.URL: "value_text",
    CustomFieldType.NUMBER: "value_number",
    CustomFieldType.DATE: "value_date",
    CustomFieldType.CHECKBOX: "value_boolean",
    CustomFieldType.SINGLE_SELECT: "value_option",
    CustomFieldType.MULTI_SELECT: "value_options",
    CustomFieldType.MEMBER: "value_member",
}


class CustomFieldDefinition(ProjectBaseModel):
    """A custom field defined on a project; applies to that project's work items."""

    name = models.CharField(max_length=255, verbose_name="Field Name")
    # Stable, programmatic key (slug of name) used by clients/imports.
    key = models.SlugField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    field_type = models.CharField(max_length=20, choices=CustomFieldType.choices)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sequence = models.FloatField(default=65535)
    # Type-specific configuration (e.g. number precision, default value, url settings).
    settings = models.JSONField(default=dict, blank=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        verbose_name = "Custom Field"
        verbose_name_plural = "Custom Fields"
        db_table = "custom_field_definitions"
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(
                fields=["project", "key"],
                condition=Q(deleted_at__isnull=True),
                name="customfield_unique_key_project_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.name} <{self.project.name}>"

    @property
    def has_options(self):
        return self.field_type in SELECT_TYPES

    def save(self, *args, **kwargs):
        if not self.key:
            self.key = slugify(self.name)
        if self._state.adding:
            last_sequence = CustomFieldDefinition.objects.filter(project=self.project).aggregate(
                largest=models.Max("sequence")
            )["largest"]
            if last_sequence is not None:
                self.sequence = last_sequence + 15000
        # ProjectBaseModel.save() sets workspace from project.
        super().save(*args, **kwargs)


class CustomFieldOption(ProjectBaseModel):
    """A selectable option for single_select / multi_select custom fields."""

    field = models.ForeignKey(CustomFieldDefinition, on_delete=models.CASCADE, related_name="options")
    name = models.CharField(max_length=255)
    color = models.CharField(max_length=255, blank=True, default="")
    sequence = models.FloatField(default=65535)
    is_active = models.BooleanField(default=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        verbose_name = "Custom Field Option"
        verbose_name_plural = "Custom Field Options"
        db_table = "custom_field_options"
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(
                fields=["field", "name"],
                condition=Q(deleted_at__isnull=True),
                name="customfieldoption_unique_name_field_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.name} <{self.field.name}>"

    def save(self, *args, **kwargs):
        if self._state.adding:
            last_sequence = CustomFieldOption.objects.filter(field=self.field).aggregate(
                largest=models.Max("sequence")
            )["largest"]
            if last_sequence is not None:
                self.sequence = last_sequence + 15000
        super().save(*args, **kwargs)


class CustomFieldValue(ProjectBaseModel):
    """The value of one custom field on one work item.

    A single row holds a field's value for a work item. The column used depends
    on the field's type (see ``VALUE_ATTR_BY_TYPE``):
      - text / long_text / url -> value_text
      - number                 -> value_number
      - date                   -> value_date
      - checkbox               -> value_boolean
      - single_select          -> value_option
      - multi_select           -> value_options (M2M)
      - member                 -> value_member
    """

    field = models.ForeignKey(CustomFieldDefinition, on_delete=models.CASCADE, related_name="values")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="custom_field_values")

    value_text = models.TextField(null=True, blank=True)
    value_number = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True)
    value_date = models.DateField(null=True, blank=True)
    value_boolean = models.BooleanField(null=True, blank=True)
    value_option = models.ForeignKey(
        CustomFieldOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="single_select_values",
    )
    value_options = models.ManyToManyField(
        CustomFieldOption,
        blank=True,
        related_name="multi_select_values",
    )
    value_member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="custom_field_values",
    )

    class Meta:
        verbose_name = "Custom Field Value"
        verbose_name_plural = "Custom Field Values"
        db_table = "custom_field_values"
        ordering = ("field__sequence",)
        constraints = [
            models.UniqueConstraint(
                fields=["field", "issue"],
                condition=Q(deleted_at__isnull=True),
                name="customfieldvalue_unique_field_issue_when_deleted_at_null",
            )
        ]
        indexes = [
            # Speeds up the BD per-profile visibility filter (field + option, live rows only).
            models.Index(
                fields=["field", "value_option"],
                condition=Q(deleted_at__isnull=True),
                name="cfv_field_option_active_idx",
            ),
        ]

    def __str__(self):
        return f"{self.field.name} = {self.get_value()} <{self.issue_id}>"

    @property
    def storage_attr(self):
        """Name of the column that backs this value's field type."""
        return VALUE_ATTR_BY_TYPE.get(self.field.field_type)

    def get_value(self):
        """Return the stored value for this field type (M2M returns a queryset)."""
        attr = self.storage_attr
        return getattr(self, attr) if attr else None

    def clean(self):
        """Type-aware validation. Call full_clean() before saving from app code."""
        field_type = self.field.field_type

        # URL fields get URL validation (first-class handling beyond plain text).
        if field_type == CustomFieldType.URL and self.value_text:
            URLValidator(message="Enter a valid URL.")(self.value_text)

        # Select options must belong to the same field definition.
        if field_type == CustomFieldType.SINGLE_SELECT and self.value_option_id:
            if self.value_option.field_id != self.field_id:
                raise ValidationError("Selected option does not belong to this field.")
