/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import {
  Type,
  AlignLeft,
  Link2,
  Hash,
  CalendarDays,
  ToggleRight,
  CircleDot,
  ListChecks,
  CircleUser,
  ExternalLink,
} from "lucide-react";
import type { ICustomSearchSelectOption } from "@plane/types";
import { CustomSearchSelect, Input, ToggleSwitch } from "@plane/ui";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
// hooks
import { useMember } from "@/hooks/store/use-member";
// services
import { WorkspaceService } from "@/services/workspace.service";
// types
import type { ICustomField, ICustomFieldValue, TCustomFieldType } from "@/types/custom-field";

const workspaceService = new WorkspaceService();

// Name of the BD "Profile" field — restricted BDs only see the profiles assigned to them.
const PROFILE_FIELD_NAME = "Profile";
// Name of the "Assigned Dev" MEMBER field — its dropdown lists ONLY Dev-team members
// (the backend independently gates who may WRITE it; this only narrows the picker).
const ASSIGNED_DEV_FIELD_NAME = "Assigned Dev";

export const CUSTOM_FIELD_ICONS: Record<TCustomFieldType, React.FC<{ className?: string }>> = {
  text: Type,
  long_text: AlignLeft,
  url: Link2,
  number: Hash,
  date: CalendarDays,
  checkbox: ToggleRight,
  single_select: CircleDot,
  multi_select: ListChecks,
  member: CircleUser,
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  field: ICustomField;
  valueObject: ICustomFieldValue | undefined;
  disabled: boolean;
  onSet: (value: unknown) => Promise<void>;
  onClear: () => Promise<void>;
};

/** Local-edit input for text / long_text / url / number that commits on blur or Enter. */
const EditableTextValue = observer(function EditableTextValue(props: {
  field: ICustomField;
  value: string | number | null;
  disabled: boolean;
  onSet: (value: unknown) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const { field, value, disabled, onSet, onClear } = props;
  const [draft, setDraft] = useState<string>(value != null ? String(value) : "");

  // keep the local draft in sync when the store value changes underneath us
  useEffect(() => setDraft(value != null ? String(value) : ""), [value]);

  const commit = () => {
    const trimmed = draft.trim();
    const current = value != null ? String(value) : "";
    if (trimmed === current) return;
    if (trimmed === "") {
      if (!field.is_required) onClear();
      else setDraft(current); // required: revert empty edits
      return;
    }
    onSet(field.field_type === "number" ? Number(trimmed) : trimmed);
  };

  const placeholder = field.is_required ? "Required" : "Empty";
  const className = "w-full px-2 py-1 text-body-xs-regular hover:bg-layer-1 focus:bg-layer-1";

  if (field.field_type === "long_text") {
    return (
      <textarea
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        rows={2}
        className={`${className} rounded-sm border-none bg-transparent focus:outline-none`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        }}
      />
    );
  }

  return (
    <div className="flex w-full items-center gap-1">
      <Input
        type={field.field_type === "number" ? "number" : field.field_type === "url" ? "url" : "text"}
        mode="true-transparent"
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {field.field_type === "url" && value ? (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-tertiary hover:text-primary"
        >
          <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
});

export const CustomFieldValueControl = observer(function CustomFieldValueControl(props: Props) {
  const { projectId, field, valueObject, disabled, onSet, onClear } = props;
  const value = valueObject?.value ?? null;
  const { workspaceSlug } = useParams();
  const {
    workspace: { workspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();

  // The "Assigned Dev" MEMBER field is assignable to Dev-team members only, so restrict its
  // picker to workspace members whose team === "dev". (undefined => MemberDropdown falls back
  // to its normal project roster, used by every other member field.)
  const isAssignedDevField = field.name === ASSIGNED_DEV_FIELD_NAME;
  const devMemberIds = isAssignedDevField
    ? (workspaceMemberIds ?? []).filter((id) => getWorkspaceMemberDetails(id)?.team === "dev")
    : undefined;

  // For the "Profile" field, a restricted BD may only choose profiles assigned to them.
  // The backend is the real guard; this just narrows the dropdown. Fetched once per slug.
  const isProfileField = field.name === PROFILE_FIELD_NAME;
  const { data: myProfiles } = useSWR(
    isProfileField && workspaceSlug && projectId ? ["bd-my-profiles", workspaceSlug.toString(), projectId] : null,
    isProfileField && workspaceSlug && projectId
      ? () => workspaceService.getMyProfileAssignments(workspaceSlug.toString(), projectId)
      : null
  );
  const restrictProfile = isProfileField && !!myProfiles?.restricted;

  switch (field.field_type) {
    case "text":
    case "long_text":
    case "url":
    case "number":
      return (
        <EditableTextValue
          field={field}
          value={value as string | number | null}
          disabled={disabled}
          onSet={onSet}
          onClear={onClear}
        />
      );

    case "date":
      return (
        <DateDropdown
          value={value ? (value as string) : null}
          onChange={(val) => (val ? onSet(renderFormattedPayloadDate(val)) : onClear())}
          disabled={disabled}
          placeholder={field.is_required ? "Required" : "Empty"}
          buttonVariant="transparent-with-text"
          className="group w-full grow"
          buttonContainerClassName="w-full text-left h-7.5"
          buttonClassName={`text-body-xs-regular ${value ? "" : "text-placeholder"}`}
          hideIcon
          clearIconClassName="h-3 w-3 hidden group-hover:inline"
        />
      );

    case "checkbox":
      return <ToggleSwitch value={Boolean(value)} onChange={(val) => onSet(val)} disabled={disabled} />;

    case "member":
      return (
        <MemberDropdown
          value={(value as string) ?? null}
          onChange={(val) => (val ? onSet(val) : onClear())}
          disabled={disabled}
          projectId={projectId}
          memberIds={devMemberIds}
          multiple={false}
          placeholder={field.is_required ? "Required" : "Empty"}
          buttonVariant="transparent-with-text"
          className="group w-full grow"
          buttonContainerClassName="w-full text-left h-7.5"
          buttonClassName={`text-body-xs-regular ${value ? "" : "text-placeholder"}`}
          dropdownArrow
          dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
        />
      );

    case "single_select":
    case "multi_select": {
      const isMulti = field.field_type === "multi_select";
      const allowedProfileIds = new Set(myProfiles?.profile_option_ids ?? []);
      const activeOptions = (field.options ?? [])
        .filter((o) => o.is_active)
        // Restricted BD on the Profile field: only their assigned options.
        .filter((o) => !restrictProfile || allowedProfileIds.has(o.id));
      const options: ICustomSearchSelectOption[] = activeOptions.map((o) => ({
        value: o.id,
        query: o.name,
        content: (
          <span className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color || "#6b7280" }} />
            <span className="truncate">{o.name}</span>
          </span>
        ),
      }));
      // Optional single-selects get a "None" entry to clear the value. Required
      // fields cannot be cleared (the server rejects it), so we omit it there.
      // A restricted BD cannot clear the Profile, so no "None" entry for them.
      if (!isMulti && !field.is_required && !restrictProfile) {
        options.unshift({ value: "", query: "none", content: <span className="text-placeholder">None</span> });
      }

      const selectedLabel = () => {
        if (isMulti) {
          const ids = (value as string[]) ?? [];
          if (ids.length === 0) return field.is_required ? "Required" : "Empty";
          return activeOptions
            .filter((o) => ids.includes(o.id))
            .map((o) => o.name)
            .join(", ");
        }
        const opt = activeOptions.find((o) => o.id === value);
        return opt?.name ?? (field.is_required ? "Required" : "Empty");
      };

      const hasValue = isMulti ? ((value as string[]) ?? []).length > 0 : !!value;
      const label = <span className={hasValue ? "" : "text-placeholder"}>{selectedLabel()}</span>;
      const sharedProps = {
        options,
        disabled,
        label,
        className: "w-full grow",
        buttonClassName: "border-none bg-transparent px-2 h-7.5 text-body-xs-regular hover:bg-layer-1",
        optionsClassName: "w-48",
      };

      if (isMulti) {
        return (
          <CustomSearchSelect
            {...sharedProps}
            multiple
            value={(value as string[]) ?? []}
            onChange={(val: string[]) => onSet(val ?? [])}
          />
        );
      }

      return (
        <CustomSearchSelect
          {...sharedProps}
          value={(value as string) ?? ""}
          onChange={(val: string) => (val ? onSet(val) : onClear())}
        />
      );
    }

    default:
      return null;
  }
});
