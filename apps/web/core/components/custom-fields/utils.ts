/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ICustomField } from "@/types/custom-field";

/** True when the draft value carries something worth persisting for this field. */
export const hasCustomFieldValue = (field: ICustomField, value: unknown): boolean => {
  switch (field.field_type) {
    case "multi_select":
      return Array.isArray(value) && value.length > 0;
    case "checkbox":
      // an explicit true/false is meaningful; an untouched (undefined) checkbox is not
      return value === true || value === false;
    case "number":
      return value !== null && value !== undefined && value !== "";
    default:
      return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
  }
};

/** True when a required field has no acceptable value yet (blocks Save). */
export const isRequiredCustomFieldMissing = (field: ICustomField, value: unknown): boolean => {
  if (!field.is_required) return false;
  // A checkbox is always answered (false is a valid answer), so it never blocks.
  if (field.field_type === "checkbox") return false;
  return !hasCustomFieldValue(field, value);
};
