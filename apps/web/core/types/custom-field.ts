/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Custom field domain types (kept local to apps/web for now; can be promoted to
// @plane/types when the work-item panel needs them).

export type TCustomFieldType =
  | "text"
  | "long_text"
  | "url"
  | "number"
  | "date"
  | "checkbox"
  | "single_select"
  | "multi_select"
  | "member";

export const CUSTOM_FIELD_TYPES: { value: TCustomFieldType; i18n_label: string }[] = [
  { value: "text", i18n_label: "Text" },
  { value: "long_text", i18n_label: "Long text" },
  { value: "number", i18n_label: "Number" },
  { value: "url", i18n_label: "URL" },
  { value: "date", i18n_label: "Date" },
  { value: "checkbox", i18n_label: "Checkbox" },
  { value: "single_select", i18n_label: "Single select" },
  { value: "multi_select", i18n_label: "Multi select" },
  { value: "member", i18n_label: "Member" },
];

export const CUSTOM_FIELD_SELECT_TYPES: TCustomFieldType[] = ["single_select", "multi_select"];

export const fieldTypeHasOptions = (fieldType: TCustomFieldType | undefined): boolean =>
  !!fieldType && CUSTOM_FIELD_SELECT_TYPES.includes(fieldType);

export interface ICustomFieldOption {
  id: string;
  field: string;
  project_id: string;
  workspace_id: string;
  name: string;
  color: string;
  sequence: number;
  is_active: boolean;
}

export interface ICustomField {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  key: string;
  description: string;
  field_type: TCustomFieldType;
  is_required: boolean;
  is_active: boolean;
  sequence: number;
  settings: Record<string, unknown>;
  options: ICustomFieldOption[];
}
