/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import useSWR from "swr";
// plane imports
import { ETabIndices } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { StatePropertyIcon, PriorityPropertyIcon } from "@plane/propel/icons";
import type { TIssue } from "@plane/types";
import { getTabIndex } from "@plane/utils";
// components
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { CUSTOM_FIELD_ICONS, CustomFieldValueControl } from "@/components/custom-fields";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useCustomField } from "@/hooks/store/use-custom-field";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types
import type { ICustomFieldValue } from "@/types/custom-field";

type Props = {
  control: Control<TIssue>;
  id: string | undefined;
  projectId: string | null;
  workspaceSlug: string;
  handleFormChange: () => void;
};

export const CreateWorkItemProperties = observer(function CreateWorkItemProperties(props: Props) {
  const { control, id, projectId, workspaceSlug, handleFormChange } = props;
  const { t } = useTranslation();
  const { isMobile } = usePlatformOS();
  const { getProjectCustomFields, fetchCustomFields } = useCustomField();
  const { customFieldValues, setCustomFieldValues, customFieldValueErrors, setCustomFieldValueErrors } =
    useIssueModal();
  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  // Definitions load at the project-wrapper level for the routed project, but the modal
  // can target another project (project select), so ensure this project's fields exist.
  useSWR(
    workspaceSlug && projectId ? `MODAL_PROJECT_CUSTOM_FIELDS_${projectId}` : null,
    workspaceSlug && projectId ? () => fetchCustomFields(workspaceSlug, projectId) : null,
    { revalidateOnFocus: false }
  );

  const fields = getProjectCustomFields(projectId);
  const activeFields = useMemo(() => (fields ?? []).filter((f) => f.is_active), [fields]);

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
    <div className="px-5">
      <h6 className="mb-3 text-body-xs-medium text-secondary">{t("common.properties")}</h6>
      {/* rows scroll as a group so the modal never grows unbounded and the footer stays visible */}
      <div className="vertical-scrollbar scrollbar-sm max-h-[35vh] space-y-2.5 overflow-y-auto pr-1">
        <Controller
          control={control}
          name="state_id"
          render={({ field: { value, onChange } }) => (
            <SidebarPropertyListItem icon={StatePropertyIcon} label={t("common.state")}>
              <StateDropdown
                value={value}
                onChange={(val) => {
                  onChange(val);
                  handleFormChange();
                }}
                projectId={projectId ?? undefined}
                buttonVariant="transparent-with-text"
                className="group w-full grow"
                buttonContainerClassName="w-full text-left h-7.5"
                buttonClassName="text-body-xs-regular"
                dropdownArrow
                dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
                isForWorkItemCreation={!id}
                tabIndex={getIndex("state_id")}
              />
            </SidebarPropertyListItem>
          )}
        />

        <Controller
          control={control}
          name="priority"
          render={({ field: { value, onChange } }) => (
            <SidebarPropertyListItem icon={PriorityPropertyIcon} label={t("common.priority")}>
              <PriorityDropdown
                value={value}
                onChange={(val) => {
                  onChange(val);
                  handleFormChange();
                }}
                buttonVariant="transparent-with-text"
                className="h-7.5 w-full grow rounded-sm"
                buttonContainerClassName="size-full text-left"
                buttonClassName="size-full px-2 py-0.5 whitespace-nowrap [&_svg]:size-3.5"
                tabIndex={getIndex("priority")}
              />
            </SidebarPropertyListItem>
          )}
        />

        {/* custom fields, in their defined sequence */}
        {projectId &&
          activeFields.map((field) => (
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
    </div>
  );
});
