/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore } from "@plane/ui";
// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
// types
import type { ICustomField } from "@/types/custom-field";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  data: ICustomField | null;
};

export const DeleteFieldModal = observer(function DeleteFieldModal(props: Props) {
  const { isOpen, onClose, data } = props;
  const { workspaceSlug, projectId } = useParams();
  const { deleteCustomField } = useCustomField();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleClose = () => {
    onClose();
    setIsDeleting(false);
  };

  const handleDeletion = async () => {
    if (!workspaceSlug || !projectId || !data) return;
    setIsDeleting(true);
    await deleteCustomField(workspaceSlug.toString(), projectId.toString(), data.id)
      .then(() => handleClose())
      .catch((error) => {
        setIsDeleting(false);
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: error?.error ?? "Custom field could not be deleted. Please try again.",
        });
      });
  };

  return (
    <AlertModalCore
      handleClose={handleClose}
      handleSubmit={handleDeletion}
      isSubmitting={isDeleting}
      isOpen={isOpen}
      title="Delete custom field"
      content={
        <>
          Are you sure you want to delete <span className="font-medium text-primary">{data?.name}</span>? This will
          remove the field and any values set on work items in this project.
        </>
      }
    />
  );
});
