/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { Calendar } from "lucide-react";
// plane imports
import type { TLeadDatePreset } from "@plane/constants";
import { LEAD_DATE_PRESETS } from "@plane/constants";
import type { IWorkItemFilterInstance } from "@plane/shared-state";
import type { TWorkItemFilterProperty } from "@plane/types";
import { COMPARISON_OPERATOR, EQUALITY_OPERATOR, LOGICAL_OPERATOR } from "@plane/types";
import { CustomSearchSelect } from "@plane/ui";
import {
  detectLeadDatePreset,
  getCreatedAtRangeFromExpression,
  renderFormattedPayloadDate,
  resolveLeadDateRange,
  type TLeadDateRange,
} from "@plane/utils";
// components
import { DateRangeDropdown } from "@/components/dropdowns/date-range";
// local storage
import { leadDatePresetStorage } from "@/lib/lead-date-preset-storage";

const CREATED_AT: TWorkItemFilterProperty = "created_at";

type Props = {
  filter: IWorkItemFilterInstance;
  workspaceSlug: string;
  projectId: string;
  userId: string | undefined;
};

/**
 * Leads pipeline "Date range" control. It does not hold any filter state of its own — it drives the
 * native `created_at` rich-filter on the shared filter instance, so board / list / spreadsheet all
 * honor it and it persists through the normal filter machinery. The selected preset *key* is stored
 * per-user-per-project (local storage) and re-resolved on load by the seam in ProjectLayoutRoot.
 */
export const LeadDateRangeFilter = observer(function LeadDateRangeFilter(props: Props) {
  const { filter, workspaceSlug, projectId, userId } = props;

  // The live filter expression is the source of truth for what is applied.
  const externalExpression = filter.adapter.toExternal(filter.expression);
  const detectedPreset = detectLeadDatePreset(externalExpression);
  const currentRange = getCreatedAtRangeFromExpression(externalExpression);

  // Local UI preset lets "Custom" show its range picker even before a range is picked. For every
  // other preset we defer to what is actually applied (detected), so the pill can never lie.
  const [uiPreset, setUiPreset] = useState<TLeadDatePreset>(detectedPreset);
  const activePreset: TLeadDatePreset = uiPreset === "custom" ? "custom" : detectedPreset;

  // Keep the stored intent in sync with what is actually applied — this also captures edits made
  // directly on the native created_at chip. Skip only the transient "custom chosen, no range yet".
  const lastPersisted = useRef<TLeadDatePreset | null>(null);
  useEffect(() => {
    if (uiPreset === "custom" && detectedPreset !== "custom") return;
    if (lastPersisted.current === detectedPreset) return;
    lastPersisted.current = detectedPreset;
    leadDatePresetStorage.set(workspaceSlug, projectId, userId, detectedPreset);
  }, [detectedPreset, uiPreset, workspaceSlug, projectId, userId]);

  // Apply an absolute range to the native created_at filter (or clear it when null).
  const applyRange = (range: TLeadDateRange | null) => {
    // always drop any single-date (exact) created_at conditions first
    filter
      .findConditionsByPropertyAndOperator(CREATED_AT, EQUALITY_OPERATOR.EXACT)
      .forEach((condition) => filter.removeCondition(condition.id));
    const existingRange = filter.findFirstConditionByPropertyAndOperator(CREATED_AT, COMPARISON_OPERATOR.RANGE);
    if (!range) {
      if (existingRange) filter.removeCondition(existingRange.id);
      return;
    }
    if (existingRange) filter.updateConditionValue(existingRange.id, range);
    else
      filter.addCondition(
        LOGICAL_OPERATOR.AND,
        { property: CREATED_AT, operator: COMPARISON_OPERATOR.RANGE, value: range },
        false
      );
  };

  const handlePresetChange = (preset: TLeadDatePreset) => {
    setUiPreset(preset);
    leadDatePresetStorage.set(workspaceSlug, projectId, userId, preset);
    if (preset === "custom") return; // wait for the range picker to supply dates
    applyRange(resolveLeadDateRange(preset));
  };

  const options = LEAD_DATE_PRESETS.map((preset) => ({
    value: preset.key,
    query: preset.label,
    content: <span className="flex-grow truncate">{preset.label}</span>,
  }));
  const activeLabel = LEAD_DATE_PRESETS.find((preset) => preset.key === activePreset)?.label;

  return (
    <div className="flex items-center gap-2">
      <CustomSearchSelect
        value={[activePreset]}
        onChange={(val: TLeadDatePreset) => handlePresetChange(val)}
        options={options}
        label={
          <div className="flex items-center gap-2 p-1">
            <Calendar className="h-4 w-4" />
            {activeLabel}
          </div>
        }
      />
      {activePreset === "custom" && (
        <DateRangeDropdown
          buttonVariant="border-with-text"
          mergeDates
          isClearable
          maxDate={new Date()}
          value={{
            from: currentRange?.[0] ? new Date(currentRange[0]) : undefined,
            to: currentRange?.[1] ? new Date(currentRange[1]) : undefined,
          }}
          onSelect={(range) => {
            const from = range?.from ? renderFormattedPayloadDate(range.from) : undefined;
            const to = range?.to ? renderFormattedPayloadDate(range.to) : undefined;
            applyRange(from && to ? [from, to] : null);
          }}
          placeholder={{ from: "From date", to: "To date" }}
        />
      )}
    </div>
  );
});
