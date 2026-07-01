/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, CheckIcon, ChevronDownIcon, Eraser } from "lucide-react";
// i18n
import { useTranslation } from "@plane/i18n";
// types
import type { IIssueDisplayFilterOptions } from "@plane/types";
// ui
import { Avatar, CustomMenu, Row } from "@plane/ui";
import { getFileURL, renderFormattedDate } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useCustomField } from "@/hooks/store/use-custom-field";
import useLocalStorage from "@/hooks/use-local-storage";
// types
import type { ICustomField, TCustomFieldType } from "@/types/custom-field";

// Types that sort sensibly by a single column. checkbox / multi_select / member
// are intentionally excluded.
export const CUSTOM_FIELD_SORTABLE: ReadonlySet<TCustomFieldType> = new Set([
  "text",
  "long_text",
  "url",
  "number",
  "date",
  "single_select",
]);

// ---------------------------------------------------------------- header cell
type HeaderProps = {
  field: ICustomField;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  onClose: () => void;
};

export const SpreadsheetCustomFieldHeader = observer(function SpreadsheetCustomFieldHeader(props: HeaderProps) {
  const { field, displayFilters, handleDisplayFilterUpdate, onClose } = props;
  const { t } = useTranslation();
  const { storedValue: selectedMenuItem, setValue: setSelectedMenuItem } = useLocalStorage(
    "spreadsheetViewSorting",
    ""
  );
  const { storedValue: activeSortingProperty, setValue: setActiveSortingProperty } = useLocalStorage(
    "spreadsheetViewActiveSortingProperty",
    ""
  );

  const ascendingKey = `custom_field__${field.id}` as const;
  const descendingKey = `-custom_field__${field.id}` as const;

  const handleOrderBy = (order: IIssueDisplayFilterOptions["order_by"], itemKey: string) => {
    handleDisplayFilterUpdate({ order_by: order });
    setSelectedMenuItem(`${order}_${itemKey}`);
    setActiveSortingProperty(order === "-created_at" ? "" : itemKey);
  };

  const label = (
    <Row className="flex w-full items-center justify-between gap-1.5 py-2 text-13 text-secondary">
      <span className="truncate">{field.name}</span>
    </Row>
  );

  // Non-sortable types render a plain, non-interactive header.
  if (!CUSTOM_FIELD_SORTABLE.has(field.field_type)) return label;

  return (
    <CustomMenu
      customButtonClassName="clickable !w-full"
      customButtonTabIndex={-1}
      className="!w-full"
      customButton={
        <Row className="flex w-full cursor-pointer items-center justify-between gap-1.5 py-2 text-13 text-secondary hover:text-primary">
          <span className="truncate">{field.name}</span>
          <div className="ml-3 flex">
            {activeSortingProperty === field.id && (
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full">
                {displayFilters.order_by === ascendingKey ? (
                  <ArrowDownWideNarrow className="h-3 w-3" />
                ) : (
                  <ArrowUpNarrowWide className="h-3 w-3" />
                )}
              </div>
            )}
            <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
          </div>
        </Row>
      }
      onMenuClose={onClose}
      placement="bottom-start"
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={() => handleOrderBy(ascendingKey, field.id)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            selectedMenuItem === `${ascendingKey}_${field.id}` ? "text-primary" : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowDownWideNarrow className="h-3 w-3 stroke-[1.5]" />
            <span>Ascending</span>
          </div>
          {selectedMenuItem === `${ascendingKey}_${field.id}` && <CheckIcon className="h-3 w-3" />}
        </div>
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => handleOrderBy(descendingKey, field.id)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            selectedMenuItem === `${descendingKey}_${field.id}` ? "text-primary" : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowUpNarrowWide className="h-3 w-3 stroke-[1.5]" />
            <span>Descending</span>
          </div>
          {selectedMenuItem === `${descendingKey}_${field.id}` && <CheckIcon className="h-3 w-3" />}
        </div>
      </CustomMenu.MenuItem>
      {selectedMenuItem && displayFilters?.order_by !== "-created_at" && selectedMenuItem.includes(field.id) && (
        <CustomMenu.MenuItem className="mt-0.5" onClick={() => handleOrderBy("-created_at", field.id)}>
          <div className="flex items-center gap-2 px-1">
            <Eraser className="h-3 w-3" />
            <span>{t("common.actions.clear_sorting")}</span>
          </div>
        </CustomMenu.MenuItem>
      )}
    </CustomMenu>
  );
});

// ------------------------------------------------------------------ body cell
type CellProps = {
  issueId: string;
  field: ICustomField;
};

export const SpreadsheetCustomFieldCell = observer(function SpreadsheetCustomFieldCell(props: CellProps) {
  const { issueId, field } = props;
  const { getCustomFieldValue } = useCustomField();
  const { getUserDetails } = useMember();
  const value = getCustomFieldValue(issueId, field.id)?.value ?? null;

  const renderValue = () => {
    switch (field.field_type) {
      case "text":
      case "long_text":
        return value ? <span className="truncate">{String(value)}</span> : null;
      case "url":
        return value ? (
          <a
            href={String(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-accent-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {String(value)}
          </a>
        ) : null;
      case "number":
        return value !== null && value !== undefined ? <span>{String(value)}</span> : null;
      case "date":
        return value ? <span>{renderFormattedDate(value as string)}</span> : null;
      case "checkbox":
        return value ? <Check className="size-4 text-accent-primary" /> : null;
      case "single_select": {
        const option = field.options?.find((o) => o.id === value);
        return option ? (
          <span className="flex items-center gap-1.5 truncate">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color || "#6b7280" }} />
            <span className="truncate">{option.name}</span>
          </span>
        ) : null;
      }
      case "multi_select": {
        const ids = (value as string[]) ?? [];
        const options = (field.options ?? []).filter((o) => ids.includes(o.id));
        if (options.length === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-1">
            {options.map((o) => (
              <span
                key={o.id}
                className="truncate rounded-sm px-1.5 py-0.5 text-11"
                style={{ backgroundColor: `${o.color || "#6b7280"}22` }}
              >
                {o.name}
              </span>
            ))}
          </div>
        );
      }
      case "member": {
        const user = value ? getUserDetails(value as string) : undefined;
        return user ? (
          <span className="flex items-center gap-1.5 truncate">
            <Avatar name={user.display_name} src={getFileURL(user.avatar_url ?? "")} size="sm" showTooltip={false} />
            <span className="truncate">{user.display_name}</span>
          </span>
        ) : null;
      }
      default:
        return null;
    }
  };

  return (
    <div className="flex h-11 items-center truncate border-b-[0.5px] border-subtle px-page-x text-13 text-primary">
      {renderValue()}
    </div>
  );
});
