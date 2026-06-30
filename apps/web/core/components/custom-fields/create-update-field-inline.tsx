/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import type { SubmitHandler } from "react-hook-form";
import { Controller, useForm } from "react-hook-form";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSelect, Input, ToggleSwitch } from "@plane/ui";
// types
import type { ICustomField } from "@/types/custom-field";
import { CUSTOM_FIELD_TYPES } from "@/types/custom-field";

export type TFieldOperationsCallbacks = {
  createField: (data: Partial<ICustomField>) => Promise<ICustomField>;
  updateField: (fieldId: string, data: Partial<ICustomField>) => Promise<ICustomField>;
};

type Props = {
  isUpdating: boolean;
  fieldToUpdate?: ICustomField;
  fieldOperationsCallbacks: TFieldOperationsCallbacks;
  onClose: () => void;
};

const defaultValues: Partial<ICustomField> = {
  name: "",
  field_type: "text",
  is_required: false,
};

export const CreateUpdateFieldInline = observer(function CreateUpdateFieldInline(props: Props) {
  const { isUpdating, fieldToUpdate, fieldOperationsCallbacks, onClose } = props;
  const { t } = useTranslation();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ICustomField>({
    defaultValues: fieldToUpdate
      ? {
          name: fieldToUpdate.name,
          field_type: fieldToUpdate.field_type,
          is_required: fieldToUpdate.is_required,
        }
      : defaultValues,
  });

  const handleClose = () => {
    reset(defaultValues);
    onClose();
  };

  const onSubmit: SubmitHandler<ICustomField> = async (formData) => {
    if (isSubmitting) return;
    // field_type is immutable once created; only name + required are editable on update.
    const payload: Partial<ICustomField> = isUpdating
      ? { name: formData.name, is_required: formData.is_required }
      : { name: formData.name, field_type: formData.field_type, is_required: formData.is_required };

    const op =
      isUpdating && fieldToUpdate
        ? fieldOperationsCallbacks.updateField(fieldToUpdate.id, payload)
        : fieldOperationsCallbacks.createField(payload);

    await op
      .then(() => handleClose())
      .catch((error) => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("error"),
          message: error?.error ?? error?.name ?? t("project_settings.custom_fields.toast.error"),
        });
      });
  };

  return (
    <div className="my-2 w-full rounded-sm border border-subtle px-3.5 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        {/* name */}
        <div className="flex flex-1 flex-col gap-1">
          <Controller
            control={control}
            name="name"
            rules={{
              required: t("project_settings.custom_fields.field_name_is_required"),
              maxLength: { value: 255, message: t("project_settings.custom_fields.field_name_max_char") },
            }}
            render={({ field: { value, onChange, ref } }) => (
              <Input
                id="fieldName"
                name="name"
                type="text"
                value={value}
                onChange={onChange}
                ref={ref}
                hasError={Boolean(errors.name)}
                placeholder={t("project_settings.custom_fields.field_name")}
                className="w-full"
              />
            )}
          />
          {errors.name?.message && <p className="px-0.5 text-13 text-danger-primary">{errors.name.message}</p>}
        </div>

        {/* type (immutable on update) */}
        <div className="w-full md:w-48">
          <Controller
            control={control}
            name="field_type"
            render={({ field: { value, onChange } }) => (
              <CustomSelect
                value={value}
                onChange={onChange}
                label={CUSTOM_FIELD_TYPES.find((option) => option.value === value)?.i18n_label ?? value}
                buttonClassName="border border-subtle bg-layer-2 !rounded-md"
                disabled={isUpdating}
                input
              >
                {CUSTOM_FIELD_TYPES.map((option) => (
                  <CustomSelect.Option key={option.value} value={option.value}>
                    {option.i18n_label}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            )}
          />
        </div>

        {/* required */}
        <div className="flex items-center gap-2 md:h-9">
          <Controller
            control={control}
            name="is_required"
            render={({ field: { value, onChange } }) => (
              <ToggleSwitch value={!!value} onChange={onChange} label={t("project_settings.custom_fields.required")} />
            )}
          />
          <span className="text-13 text-secondary">{t("project_settings.custom_fields.required")}</span>
        </div>

        {/* actions */}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={(e) => {
              e.preventDefault();
              handleSubmit(onSubmit)();
            }}
            loading={isSubmitting}
          >
            {isUpdating ? (isSubmitting ? t("updating") : t("update")) : isSubmitting ? t("adding") : t("add")}
          </Button>
        </div>
      </div>
    </div>
  );
});
