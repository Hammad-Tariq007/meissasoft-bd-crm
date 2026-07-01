/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { ISearchIssueResponse, TIssue } from "@plane/types";
// components
import { hasCustomFieldValue, isRequiredCustomFieldMissing } from "@/components/custom-fields";
import { IssueModalContext } from "@/components/issues/issue-modal/context";
import type {
  TCreateCustomFieldValuesProps,
  TCustomFieldValuesValidationProps,
} from "@/components/issues/issue-modal/context";
// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
import { useUser } from "@/hooks/store/user/user-user";

export type TIssueModalProviderProps = {
  templateId?: string;
  dataForPreload?: Partial<TIssue>;
  allowedProjectIds?: string[];
  children: React.ReactNode;
};

export const IssueModalProvider = observer(function IssueModalProvider(props: TIssueModalProviderProps) {
  const { children, allowedProjectIds } = props;
  // states
  const [selectedParentIssue, setSelectedParentIssue] = useState<ISearchIssueResponse | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldValueErrors, setCustomFieldValueErrors] = useState<Record<string, boolean>>({});
  // store hooks
  const { projectsWithCreatePermissions } = useUser();
  const { getProjectCustomFields, setCustomFieldValue } = useCustomField();
  // derived values
  const projectIdsWithCreatePermissions = Object.keys(projectsWithCreatePermissions ?? {});

  const handleCustomFieldValuesValidation = ({ projectId }: TCustomFieldValuesValidationProps) => {
    if (!projectId) return true;
    const requiredFields = (getProjectCustomFields(projectId) ?? []).filter((f) => f.is_active && f.is_required);
    const errors: Record<string, boolean> = {};
    requiredFields.forEach((field) => {
      if (isRequiredCustomFieldMissing(field, customFieldValues[field.id])) errors[field.id] = true;
    });
    setCustomFieldValueErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Create-then-set: called AFTER the lead exists, with its id. One upsert per field
  // that has a value; writes run together and each is guarded, so a failed write never
  // throws — the lead is never rolled back. Failures are collected by field name.
  const handleCreateCustomFieldValues = async ({
    issueId,
    projectId,
    workspaceSlug,
  }: TCreateCustomFieldValuesProps) => {
    const fieldsToWrite = (getProjectCustomFields(projectId) ?? []).filter(
      (f) => f.is_active && hasCustomFieldValue(f, customFieldValues[f.id])
    );
    const results = await Promise.allSettled(
      fieldsToWrite.map((field) =>
        setCustomFieldValue(workspaceSlug, projectId, issueId, field.id, customFieldValues[field.id])
      )
    );
    const failedFieldNames = fieldsToWrite.filter((_, i) => results[i].status === "rejected").map((f) => f.name);
    return { failedFieldNames };
  };

  return (
    <IssueModalContext.Provider
      value={{
        allowedProjectIds: allowedProjectIds ?? projectIdsWithCreatePermissions,
        workItemTemplateId: null,
        setWorkItemTemplateId: () => {},
        isApplyingTemplate: false,
        setIsApplyingTemplate: () => {},
        selectedParentIssue,
        setSelectedParentIssue,
        issuePropertyValues: {},
        setIssuePropertyValues: () => {},
        issuePropertyValueErrors: {},
        setIssuePropertyValueErrors: () => {},
        customFieldValues,
        setCustomFieldValues,
        customFieldValueErrors,
        setCustomFieldValueErrors,
        handleCustomFieldValuesValidation,
        handleCreateCustomFieldValues,
        getIssueTypeIdOnProjectChange: () => null,
        getActiveAdditionalPropertiesLength: () => 0,
        handlePropertyValuesValidation: () => true,
        handleCreateUpdatePropertyValues: () => Promise.resolve(),
        handleProjectEntitiesFetch: () => Promise.resolve(),
        handleTemplateChange: () => Promise.resolve(),
        handleConvert: () => Promise.resolve(),
        handleCreateSubWorkItem: () => Promise.resolve(),
      }}
    >
      {children}
    </IssueModalContext.Provider>
  );
});
