/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
// types
import type { ICustomField, ICustomFieldOption } from "@/types/custom-field";
// local imports
import { CreateUpdateOptionInline } from "./create-update-option-inline";

type Props = {
  field: ICustomField;
  isEditable: boolean;
};

export const OptionList = observer(function OptionList(props: Props) {
  const { field, isEditable } = props;
  const { workspaceSlug, projectId } = useParams();
  const { t } = useTranslation();
  const { createOption, updateOption, deleteOption, reorderOptions } = useCustomField();
  // states
  const [showCreate, setShowCreate] = useState(false);
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  const options = field.options ?? [];

  const handleCreate = (data: Partial<ICustomFieldOption>) => createOption(ws!, pid!, field.id, data);
  const handleUpdate = (optionId: string, data: Partial<ICustomFieldOption>) =>
    updateOption(ws!, pid!, field.id, optionId, data);

  const handleDelete = async (optionId: string) => {
    await deleteOption(ws!, pid!, field.id, optionId).catch((error) => {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: error?.error ?? t("project_settings.custom_fields.toast.error"),
      });
    });
  };

  // up/down reorder: swap with neighbor and persist the new id order
  const move = async (index: number, direction: -1 | 1) => {
    if (!ws || !pid) return;
    const target = index + direction;
    if (target < 0 || target >= options.length) return;
    const ids = options.map((option) => option.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorderOptions(ws!, pid!, field.id, ids).catch((error) => {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: error?.error ?? t("project_settings.custom_fields.toast.error"),
      });
    });
  };

  return (
    <div className="mt-1 ml-7 flex flex-col gap-1 border-l border-subtle pl-4">
      {options.length === 0 && !showCreate && (
        <p className="py-1 text-13 text-tertiary">{t("project_settings.custom_fields.empty_options")}</p>
      )}

      {options.map((option, index) =>
        editingOptionId === option.id ? (
          <CreateUpdateOptionInline
            key={option.id}
            isUpdating
            optionToUpdate={option}
            onSubmitOption={(data) => handleUpdate(option.id, data)}
            onClose={() => setEditingOptionId(null)}
          />
        ) : (
          <div key={option.id} className="group flex items-center gap-2 py-1">
            <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: option.color || "#000" }} />
            <span className="flex-1 truncate text-13 text-primary">{option.name}</span>
            {isEditable && (
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded p-1 text-tertiary hover:text-primary disabled:opacity-30"
                  aria-label="Move option up"
                >
                  <ChevronUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === options.length - 1}
                  className="rounded p-1 text-tertiary hover:text-primary disabled:opacity-30"
                  aria-label="Move option down"
                >
                  <ChevronDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingOptionId(option.id)}
                  className="rounded px-1 py-1 text-13 text-tertiary hover:text-primary"
                >
                  {t("edit")}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(option.id)}
                  className="rounded p-1 text-tertiary hover:text-danger-primary"
                  aria-label="Delete option"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        )
      )}

      {showCreate && (
        <CreateUpdateOptionInline
          isUpdating={false}
          onSubmitOption={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {isEditable && !showCreate && (
        <Button variant="link" size="sm" onClick={() => setShowCreate(true)} className="mt-1 w-fit !px-0">
          <Plus className="size-3.5" />
          {t("project_settings.custom_fields.add_option")}
        </Button>
      )}
    </div>
  );
});
