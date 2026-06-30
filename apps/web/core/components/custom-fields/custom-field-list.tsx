/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Loader } from "@plane/ui";
// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
import { useUserPermissions } from "@/hooks/store/user";
// types
import type { ICustomField } from "@/types/custom-field";
// components
import { SettingsHeading } from "@/components/settings/heading";
import type { TFieldOperationsCallbacks } from "./create-update-field-inline";
import { CreateUpdateFieldInline } from "./create-update-field-inline";
import { CustomFieldItem } from "./field-item";
import { DeleteFieldModal } from "./delete-field-modal";

const SEQUENCE_STEP = 15000;

export const CustomFieldList = observer(function CustomFieldList() {
  const { workspaceSlug, projectId } = useParams();
  const { t } = useTranslation();
  const { projectCustomFields, createCustomField, updateCustomField } = useCustomField();
  const { allowPermissions } = useUserPermissions();
  // states
  const [showCreate, setShowCreate] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<ICustomField | null>(null);

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  const isEditable = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);

  const fieldOperationsCallbacks: TFieldOperationsCallbacks = {
    createField: (data) => createCustomField(ws!, pid!, data),
    updateField: (fieldId, data) => updateCustomField(ws!, pid!, fieldId, data),
  };

  // up/down reorder: recompute the moved field's sequence between its neighbors.
  const onMove = async (index: number, direction: -1 | 1) => {
    if (!ws || !pid) return;
    const fields = projectCustomFields ?? [];
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;

    const moving = fields[index];
    let newSequence: number;
    if (direction === -1) {
      // moving up: place before the field currently above it
      const above = fields[target - 1];
      newSequence = above ? (above.sequence + fields[target].sequence) / 2 : fields[target].sequence / 2;
    } else {
      // moving down: place after the field currently below it
      const below = fields[target + 1];
      newSequence = below ? (fields[target].sequence + below.sequence) / 2 : fields[target].sequence + SEQUENCE_STEP;
    }

    await updateCustomField(ws!, pid!, moving.id, { sequence: newSequence }).catch((error) => {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: error?.error ?? t("project_settings.custom_fields.toast.error"),
      });
    });
  };

  return (
    <>
      <DeleteFieldModal isOpen={!!fieldToDelete} data={fieldToDelete} onClose={() => setFieldToDelete(null)} />
      <SettingsHeading
        title={t("project_settings.custom_fields.heading")}
        description={t("project_settings.custom_fields.description")}
        control={
          isEditable && (
            <Button variant="primary" size="lg" onClick={() => setShowCreate(true)}>
              {t("project_settings.custom_fields.add_field")}
            </Button>
          )
        }
      />

      <div className="mt-6 w-full">
        {showCreate && (
          <CreateUpdateFieldInline
            isUpdating={false}
            fieldOperationsCallbacks={fieldOperationsCallbacks}
            onClose={() => setShowCreate(false)}
          />
        )}

        {projectCustomFields ? (
          projectCustomFields.length === 0 && !showCreate ? (
            <EmptyStateCompact
              assetKey="label"
              assetClassName="size-20"
              title={t("project_settings.custom_fields.heading")}
              description={t("project_settings.custom_fields.description")}
              actions={
                isEditable
                  ? [{ label: t("project_settings.custom_fields.add_field"), onClick: () => setShowCreate(true) }]
                  : []
              }
              align="start"
              rootClassName="py-20"
            />
          ) : (
            projectCustomFields.map((field, index) => (
              <CustomFieldItem
                key={field.id}
                field={field}
                index={index}
                isFirst={index === 0}
                isLast={index === projectCustomFields.length - 1}
                isEditable={isEditable}
                fieldOperationsCallbacks={fieldOperationsCallbacks}
                onMove={onMove}
                onDelete={(f) => setFieldToDelete(f)}
              />
            ))
          )
        ) : (
          !showCreate && (
            <Loader className="space-y-5">
              <Loader.Item height="42px" />
              <Loader.Item height="42px" />
              <Loader.Item height="42px" />
            </Loader>
          )
        )}
      </div>
    </>
  );
});
