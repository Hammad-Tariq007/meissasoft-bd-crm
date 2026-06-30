/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// types
import type { ICustomField } from "@/types/custom-field";
import { CUSTOM_FIELD_TYPES, fieldTypeHasOptions } from "@/types/custom-field";
// local imports
import type { TFieldOperationsCallbacks } from "./create-update-field-inline";
import { CreateUpdateFieldInline } from "./create-update-field-inline";
import { OptionList } from "./options/option-list";

type Props = {
  field: ICustomField;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isEditable: boolean;
  fieldOperationsCallbacks: TFieldOperationsCallbacks;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (field: ICustomField) => void;
};

export const CustomFieldItem = observer(function CustomFieldItem(props: Props) {
  const { field, index, isFirst, isLast, isEditable, fieldOperationsCallbacks, onMove, onDelete } = props;
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const hasOptions = fieldTypeHasOptions(field.field_type);
  const typeLabel =
    CUSTOM_FIELD_TYPES.find((option) => option.value === field.field_type)?.i18n_label ?? field.field_type;

  if (isEditing) {
    return (
      <CreateUpdateFieldInline
        isUpdating
        fieldToUpdate={field}
        fieldOperationsCallbacks={fieldOperationsCallbacks}
        onClose={() => setIsEditing(false)}
      />
    );
  }

  return (
    <div className="my-2 w-full rounded-sm border border-subtle px-3.5 py-2.5">
      <div className="group flex items-center gap-2">
        {hasOptions ? (
          <button
            type="button"
            onClick={() => setOptionsOpen((prev) => !prev)}
            className="rounded p-0.5 text-tertiary hover:text-primary"
            aria-label="Toggle options"
          >
            <ChevronDown className={cn("size-4 transition-transform", { "-rotate-90": !optionsOpen })} />
          </button>
        ) : (
          <span className="w-5" />
        )}

        <div className="flex flex-1 items-center gap-2 truncate">
          <span className="truncate text-14 font-medium text-primary">{field.name}</span>
          <span className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-11 text-secondary">{typeLabel}</span>
          {field.is_required && (
            <span className="bg-danger-component-surface-medium flex-shrink-0 rounded px-1.5 py-0.5 text-11 text-danger-primary">
              {t("project_settings.custom_fields.required")}
            </span>
          )}
          {!field.is_active && <span className="flex-shrink-0 text-11 text-tertiary">({t("inactive")})</span>}
        </div>

        {isEditable && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onMove(index, -1)}
              disabled={isFirst}
              className="rounded p-1 text-tertiary hover:text-primary disabled:opacity-30"
              aria-label="Move field up"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove(index, 1)}
              disabled={isLast}
              className="rounded p-1 text-tertiary hover:text-primary disabled:opacity-30"
              aria-label="Move field down"
            >
              <ChevronDown className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded p-1 text-tertiary hover:text-primary"
              aria-label="Edit field"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(field)}
              className="rounded p-1 text-tertiary hover:text-danger-primary"
              aria-label="Delete field"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>

      {hasOptions && optionsOpen && <OptionList field={field} isEditable={isEditable} />}
    </div>
  );
});
