/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// ui
import { Avatar, Tooltip } from "@plane/ui";
import { cn, getFileURL, renderFormattedDate } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useCustomField } from "@/hooks/store/use-custom-field";
import { useSpreadsheetCustomFieldColumns } from "@/hooks/use-spreadsheet-custom-field-columns";
// types
import type { ICustomField, ICustomFieldValue } from "@/types/custom-field";
// local imports
import { CUSTOM_FIELD_ICONS } from "./field-control";

const PILL_CLASSNAME =
  "flex h-5 max-w-[140px] flex-shrink-0 items-center gap-1 overflow-hidden rounded-sm border-[0.5px] border-strong px-2 py-1 text-11";

// Whether a custom-field value is worth rendering a pill for. Empty strings,
// nullish values and empty multi-select arrays are treated as "no value".
const hasValue = (value: ICustomFieldValue["value"]): boolean => {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

type PillProps = {
  field: ICustomField;
  issueId: string;
};

const CustomFieldPill = observer(function CustomFieldPill(props: PillProps) {
  const { field, issueId } = props;
  const { getCustomFieldValue } = useCustomField();
  const { getUserDetails } = useMember();

  const value = getCustomFieldValue(issueId, field.id)?.value ?? null;
  if (!hasValue(value)) return null;

  const Icon = CUSTOM_FIELD_ICONS[field.field_type];

  const renderValue = () => {
    switch (field.field_type) {
      case "text":
      case "long_text":
      case "url":
        return <span className="truncate">{String(value)}</span>;
      case "number":
        return <span className="truncate">{String(value)}</span>;
      case "date":
        return <span className="truncate">{renderFormattedDate(value as string)}</span>;
      case "checkbox":
        // only rendered when true (falsy values are filtered out by hasValue)
        return <span className="truncate">{field.name}</span>;
      case "single_select": {
        const option = field.options?.find((o) => o.id === value);
        if (!option) return null;
        return (
          <span className="flex items-center gap-1 truncate">
            <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: option.color || "#6b7280" }} />
            <span className="truncate">{option.name}</span>
          </span>
        );
      }
      case "multi_select": {
        const ids = (value as string[]) ?? [];
        const options = (field.options ?? []).filter((o) => ids.includes(o.id));
        if (options.length === 0) return null;
        const [first, ...rest] = options;
        return (
          <span className="flex items-center gap-1 truncate">
            <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: first.color || "#6b7280" }} />
            <span className="truncate">{first.name}</span>
            {rest.length > 0 && <span className="flex-shrink-0 text-tertiary">+{rest.length}</span>}
          </span>
        );
      }
      case "member": {
        const user = getUserDetails(value as string);
        if (!user) return null;
        return (
          <span className="flex items-center gap-1 truncate">
            <Avatar name={user.display_name} src={getFileURL(user.avatar_url ?? "")} size="sm" showTooltip={false} />
            <span className="truncate">{user.display_name}</span>
          </span>
        );
      }
      default:
        return null;
    }
  };

  const content = renderValue();
  if (!content) return null;

  return (
    <Tooltip tooltipHeading={field.name} tooltipContent="" renderByDefault={false}>
      {/* Display-only pill; handlers only stop the card ControlLink from navigating on pill click. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className={cn(PILL_CLASSNAME)} onClick={(e) => e.stopPropagation()} onFocus={(e) => e.stopPropagation()}>
        {Icon && <Icon className="h-3 w-3 flex-shrink-0 text-tertiary" />}
        {content}
      </div>
    </Tooltip>
  );
});

type Props = {
  issueId: string;
  projectId: string | null | undefined;
};

/**
 * Renders the project's *visible* custom fields (as toggled in the Display
 * Properties panel) as compact pills on a work-item card. Only fields that
 * actually hold a value for this work item are rendered, keeping cards tidy.
 *
 * Field definitions are loaded project-wide at the project-wrapper level, and
 * per-work-item values are bulk-loaded once per column by the kanban group
 * (see KanbanIssueBlocksList). This component only reads the shared, reactive
 * valueMap via getCustomFieldValue — it issues no fetch of its own.
 */
export const WorkItemCustomFieldPills = observer(function WorkItemCustomFieldPills(props: Props) {
  const { issueId, projectId } = props;
  const { visibleFields } = useSpreadsheetCustomFieldColumns(projectId);

  if (!projectId || visibleFields.length === 0) return null;

  return (
    <>
      {visibleFields.map((field) => (
        <CustomFieldPill key={field.id} field={field} issueId={issueId} />
      ))}
    </>
  );
});
