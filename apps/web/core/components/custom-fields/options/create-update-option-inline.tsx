/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { TwitterPicker } from "react-color";
import { Controller, useForm } from "react-hook-form";
import { Popover, Transition } from "@headlessui/react";
// plane imports
import { getRandomLabelColor, LABEL_COLOR_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Input } from "@plane/ui";
// types
import type { ICustomFieldOption } from "@/types/custom-field";

type Props = {
  isUpdating: boolean;
  optionToUpdate?: ICustomFieldOption;
  onSubmitOption: (data: Partial<ICustomFieldOption>) => Promise<unknown>;
  onClose: () => void;
};

export const CreateUpdateOptionInline = observer(function CreateUpdateOptionInline(props: Props) {
  const { isUpdating, optionToUpdate, onSubmitOption, onClose } = props;
  const { t } = useTranslation();

  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Partial<ICustomFieldOption>>({
    defaultValues: {
      name: optionToUpdate?.name ?? "",
      color: optionToUpdate?.color || getRandomLabelColor(),
    },
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (formData: Partial<ICustomFieldOption>) => {
    if (isSubmitting) return;
    await onSubmitOption(formData)
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
    <div className="flex w-full items-center gap-2 py-1.5">
      {/* color picker */}
      <div className="flex-shrink-0">
        <Popover className="relative z-10 flex items-center justify-center">
          {({ open }) => (
            <>
              <Popover.Button
                className={`group inline-flex items-center focus:outline-none ${open ? "text-primary" : "text-secondary"}`}
              >
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: watch("color") }} />
              </Popover.Button>
              <Transition
                as={React.Fragment}
                enter="transition ease-out duration-200"
                enterFrom="opacity-0 translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-150"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-1"
              >
                <Popover.Panel className="absolute top-full left-0 z-20 mt-3 w-screen max-w-xs px-2 sm:px-0">
                  <Controller
                    name="color"
                    control={control}
                    render={({ field: { value, onChange } }) => (
                      <TwitterPicker colors={LABEL_COLOR_OPTIONS} color={value} onChange={(val) => onChange(val.hex)} />
                    )}
                  />
                </Popover.Panel>
              </Transition>
            </>
          )}
        </Popover>
      </div>
      {/* name */}
      <div className="flex flex-1 flex-col">
        <Controller
          control={control}
          name="name"
          rules={{ required: t("project_settings.custom_fields.option_name_is_required") }}
          render={({ field: { value, onChange, ref } }) => (
            <Input
              id="optionName"
              name="name"
              type="text"
              value={value}
              onChange={onChange}
              ref={ref}
              hasError={Boolean(errors.name)}
              placeholder={t("project_settings.custom_fields.option_name")}
              className="w-full"
            />
          )}
        />
      </div>
      <Button variant="secondary" size="sm" onClick={handleClose}>
        {t("cancel")}
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={(e) => {
          e.preventDefault();
          handleSubmit(onSubmit)();
        }}
        loading={isSubmitting}
      >
        {isUpdating ? t("update") : t("add")}
      </Button>
    </div>
  );
});
