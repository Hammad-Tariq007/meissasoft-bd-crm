/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// components
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { CUSTOM_FIELD_ICONS, CustomFieldValueControl } from "@/components/custom-fields";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useCustomField } from "@/hooks/store/use-custom-field";
// types
import type { ICustomFieldValue } from "@/types/custom-field";

type Props = {
  projectId: string | null;
  workspaceSlug: string;
};

export const CreateWorkItemCustomFields = observer(function CreateWorkItemCustomFields(props: Props) {
  const { projectId, workspaceSlug } = props;
  const { getProjectCustomFields, fetchCustomFields } = useCustomField();
  const { customFieldValues, setCustomFieldValues, customFieldValueErrors, setCustomFieldValueErrors } =
    useIssueModal();

  // Definitions load at the project-wrapper level for the routed project, but the modal
  // can target another project (project select), so ensure this project's fields exist.
  useSWR(
    workspaceSlug && projectId ? `MODAL_PROJECT_CUSTOM_FIELDS_${projectId}` : null,
    workspaceSlug && projectId ? () => fetchCustomFields(workspaceSlug, projectId) : null,
    { revalidateOnFocus: false }
  );

  const fields = getProjectCustomFields(projectId);
  const activeFields = useMemo(() => (fields ?? []).filter((f) => f.is_active), [fields]);

  if (!projectId || activeFields.length === 0) return null;

  const handleSet = (fieldId: string, value: unknown) => {
    setCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    // clear the error as soon as the field is given a value
    setCustomFieldValueErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const handleClear = (fieldId: string) => {
    setCustomFieldValues((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  return (
    <div className="space-y-2 px-5">
      {activeFields.map((field) => (
        <SidebarPropertyListItem
          key={field.id}
          icon={CUSTOM_FIELD_ICONS[field.field_type]}
          label={field.name}
          appendElement={field.is_required ? <span className="text-danger-primary">*</span> : undefined}
          childrenClassName={customFieldValueErrors[field.id] ? "rounded-sm ring-1 ring-danger-primary" : undefined}
        >
          <CustomFieldValueControl
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId=""
            field={field}
            valueObject={
              { value: (customFieldValues[field.id] ?? null) as ICustomFieldValue["value"] } as ICustomFieldValue
            }
            disabled={false}
            onSet={async (v) => handleSet(field.id, v)}
            onClear={async () => handleClear(field.id)}
          />
        </SidebarPropertyListItem>
      ))}
    </div>
  );
});
