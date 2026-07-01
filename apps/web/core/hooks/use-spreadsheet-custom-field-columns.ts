/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
import useLocalStorage from "@/hooks/use-local-storage";
// types
import type { ICustomField } from "@/types/custom-field";

/**
 * Spreadsheet custom-field column visibility, persisted per project in
 * localStorage (per-browser, by design). Column show/hide is stored as the set
 * of *hidden* field ids so newly-created fields default to visible. The
 * underlying useLocalStorage dispatches a storage event on write, so the
 * display-properties toggle and the rendered columns stay in sync.
 */
export const useSpreadsheetCustomFieldColumns = (projectId: string | undefined | null) => {
  const { getProjectCustomFields } = useCustomField();

  const { storedValue, setValue } = useLocalStorage<string[]>(
    `spreadsheetHiddenCustomFields_${projectId ?? "none"}`,
    []
  );
  const hiddenFieldIds = storedValue ?? [];

  // Active custom fields for this project, in their configured order.
  const fields: ICustomField[] = (getProjectCustomFields(projectId) ?? []).filter((field) => field.is_active);

  const isVisible = (fieldId: string) => !hiddenFieldIds.includes(fieldId);

  const toggle = (fieldId: string) => {
    setValue(
      hiddenFieldIds.includes(fieldId) ? hiddenFieldIds.filter((id) => id !== fieldId) : [...hiddenFieldIds, fieldId]
    );
  };

  const visibleFields = fields.filter((field) => isVisible(field.id));

  return { fields, visibleFields, isVisible, toggle };
};
