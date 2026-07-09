/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane package imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Tabs } from "@plane/propel/tabs";
import type { ICycle, IModule, IProject } from "@plane/types";
import { Spinner } from "@plane/ui";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateRangeDropdown } from "@/components/dropdowns/date-range";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
import { useUserPermissions } from "@/hooks/store/user";
// plane web components
import { BDInsightsContent } from "../../bd-insights";
import DurationDropdown from "../../select/duration";
import TotalInsights from "../../total-insights";
import CreatedVsResolved from "../created-vs-resolved";
import CustomizedInsights from "../customized-insights";
import WorkItemsInsightTable from "../workitems-insight-table";

type Props = {
  fullScreen: boolean;
  projectDetails: IProject | undefined;
  cycleDetails: ICycle | undefined;
  moduleDetails: IModule | undefined;
  isEpic?: boolean;
};

export const WorkItemsModalMainContent = observer(function WorkItemsModalMainContent(props: Props) {
  const { projectDetails, cycleDetails, moduleDetails, fullScreen, isEpic } = props;
  const {
    updateSelectedProjects,
    updateSelectedCycle,
    updateSelectedModule,
    updateIsPeekView,
    selectedDuration,
    updateSelectedDuration,
    selectedStartDate,
    selectedEndDate,
    updateSelectedDateRange,
  } = useAnalytics();
  const { allowPermissions } = useUserPermissions();
  // BD Insights is admin-only, mirroring the backend gate (workspace ADMIN on advance-analytics-bd).
  const canViewBDInsights = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const [isModalConfigured, setIsModalConfigured] = useState(false);
  const [selectedTab, setSelectedTab] = useState("overview");

  useEffect(() => {
    updateIsPeekView(true);

    // Handle project selection
    if (projectDetails?.id) {
      updateSelectedProjects([projectDetails.id]);
    }

    // Handle cycle selection
    if (cycleDetails?.id) {
      updateSelectedCycle(cycleDetails.id);
    }

    // Handle module selection
    if (moduleDetails?.id) {
      updateSelectedModule(moduleDetails.id);
    }
    setIsModalConfigured(true);

    // Cleanup fields
    return () => {
      updateSelectedProjects([]);
      updateSelectedCycle("");
      updateSelectedModule("");
      updateIsPeekView(false);
    };
  }, [
    projectDetails?.id,
    cycleDetails?.id,
    moduleDetails?.id,
    updateSelectedProjects,
    updateSelectedCycle,
    updateSelectedModule,
    updateIsPeekView,
  ]);

  if (!isModalConfigured)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <Tabs
      value={selectedTab}
      onValueChange={(value) => value && setSelectedTab(value)}
      className="flex h-full w-full flex-col overflow-hidden"
    >
      <div className="flex w-full items-center gap-2 border-b border-subtle bg-surface-1 px-6 py-2">
        <Tabs.List className="flex h-7 w-fit overflow-x-auto">
          <Tabs.Trigger value="overview" size="md" className="h-6 px-3">
            Overview
          </Tabs.Trigger>
          {canViewBDInsights && (
            <Tabs.Trigger value="bd-insights" size="md" className="h-6 px-3">
              BD Insights
            </Tabs.Trigger>
          )}
        </Tabs.List>
        {/* Date-range scope for every widget in the panel (project is fixed to the current one). */}
        <div className="ml-auto flex items-center gap-2">
          <DurationDropdown
            buttonVariant="border-with-text"
            value={selectedDuration}
            onChange={(val) => updateSelectedDuration(val)}
            dropdownArrow
          />
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
      </div>
      <Tabs.Content value="overview" className="h-full overflow-y-auto">
        <div className="flex flex-col gap-14 p-6">
          <TotalInsights analyticsType="work-items" peekView={!fullScreen} />
          <CreatedVsResolved />
          <CustomizedInsights peekView={!fullScreen} isEpic={isEpic} />
          <WorkItemsInsightTable />
        </div>
      </Tabs.Content>
      {canViewBDInsights && (
        <Tabs.Content value="bd-insights" className="h-full overflow-y-auto">
          <div className="flex flex-col gap-14 p-6">
            <BDInsightsContent />
          </div>
        </Tabs.Content>
      )}
    </Tabs>
  );
});
