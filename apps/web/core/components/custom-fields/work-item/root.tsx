/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// components
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
// constants
import { ISSUE_CUSTOM_FIELD_VALUES } from "@/constants/fetch-keys";
// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// local imports
import { CUSTOM_FIELD_ICONS, CustomFieldValueControl } from "./field-control";

// The BD access-control field is resolved by name on the backend too (PROFILE_FIELD_NAME).
const PROFILE_FIELD_NAME = "Profile";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isEditable: boolean;
};

const errorMessage = (error: unknown, fallback: string): string => {
  const e = error as { error?: unknown };
  if (typeof e?.error === "string") return e.error;
  return fallback;
};

export const WorkItemCustomFieldProperties = observer(function WorkItemCustomFieldProperties(props: Props) {
  const { workspaceSlug, projectId, issueId, isEditable } = props;
  const {
    getProjectCustomFields,
    getCustomFieldValue,
    fetchCustomFieldValues,
    setCustomFieldValue,
    clearCustomFieldValue,
  } = useCustomField();
  const { data: currentUser } = useUser();
  const {
    workspace: { getWorkspaceMemberDetails },
  } = useMember();
  const { allowPermissions } = useUserPermissions();

  // BD CRM: a restricted BD may set Profile only at CREATE. On an EXISTING lead (this panel)
  // Profile is admin-only, so render it read-only for them (backend enforces the same).
  const memberDetails = currentUser?.id ? getWorkspaceMemberDetails(currentUser.id) : undefined;
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const isRestrictedBD = memberDetails?.team === "bd" && !memberDetails?.is_team_lead && !isWorkspaceAdmin;

  // values for this work item (definitions are loaded at the project-wrapper level)
  useSWR(
    workspaceSlug && projectId && issueId ? ISSUE_CUSTOM_FIELD_VALUES(issueId) : null,
    workspaceSlug && projectId && issueId ? () => fetchCustomFieldValues(workspaceSlug, projectId, issueId) : null,
    { revalidateOnFocus: false }
  );

  const fields = getProjectCustomFields(projectId);
  const activeFields = useMemo(() => (fields ?? []).filter((f) => f.is_active), [fields]);

  if (activeFields.length === 0) return null;

  const handleSet = async (fieldId: string, value: unknown) => {
    try {
      await setCustomFieldValue(workspaceSlug, projectId, issueId, fieldId, value);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Error", message: errorMessage(error, "Could not update the field.") });
    }
  };

  const handleClear = async (fieldId: string) => {
    try {
      await clearCustomFieldValue(workspaceSlug, projectId, issueId, fieldId);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Error", message: errorMessage(error, "Could not clear the field.") });
    }
  };

  return (
    <>
      {activeFields.map((field) => (
        <SidebarPropertyListItem
          key={field.id}
          icon={CUSTOM_FIELD_ICONS[field.field_type]}
          label={field.name}
          appendElement={field.is_required ? <span className="text-danger-primary">*</span> : undefined}
        >
          <CustomFieldValueControl
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            field={field}
            valueObject={getCustomFieldValue(issueId, field.id)}
            disabled={!isEditable || (isRestrictedBD && field.name === PROFILE_FIELD_NAME)}
            onSet={(v) => handleSet(field.id, v)}
            onClear={() => handleClear(field.id)}
          />
        </SidebarPropertyListItem>
      ))}
    </>
  );
});
