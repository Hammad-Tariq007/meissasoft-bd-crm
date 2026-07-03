/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane web components
import { observer } from "mobx-react";
// plane imports
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateRangeDropdown } from "@/components/dropdowns/date-range";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
import { useProject } from "@/hooks/store/use-project";
// components
import DurationDropdown from "./select/duration";
import { ProjectSelect } from "./select/project";

const AnalyticsFilterActions = observer(function AnalyticsFilterActions() {
  const {
    selectedProjects,
    updateSelectedProjects,
    selectedDuration,
    updateSelectedDuration,
    selectedStartDate,
    selectedEndDate,
    updateSelectedDateRange,
  } = useAnalytics();
  const { joinedProjectIds } = useProject();
  return (
    <div className="flex items-center justify-end gap-2">
      <ProjectSelect
        value={selectedProjects}
        onChange={(val) => {
          updateSelectedProjects(val ?? []);
        }}
        projectIds={joinedProjectIds}
      />
      <DurationDropdown
        buttonVariant="border-with-text"
        value={selectedDuration}
        onChange={(val) => {
          updateSelectedDuration(val);
        }}
        dropdownArrow
      />
      {/* Custom range picker only appears once the "Custom" preset is chosen. */}
      {selectedDuration === "custom" && (
        <DateRangeDropdown
          buttonVariant="border-with-text"
          mergeDates
          isClearable
          maxDate={new Date()}
          value={{
            from: selectedStartDate ? new Date(selectedStartDate) : undefined,
            to: selectedEndDate ? new Date(selectedEndDate) : undefined,
          }}
          onSelect={(range) => {
            updateSelectedDateRange(
              range?.from ? (renderFormattedPayloadDate(range.from) ?? null) : null,
              range?.to ? (renderFormattedPayloadDate(range.to) ?? null) : null
            );
          }}
          placeholder={{ from: "From date", to: "To date" }}
        />
      )}
    </div>
  );
});

export default AnalyticsFilterActions;
