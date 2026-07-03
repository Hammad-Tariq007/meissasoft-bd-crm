/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { BarChart } from "@plane/propel/charts/bar-chart";
import type { TBarItem, TChartData } from "@plane/types";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local
import AnalyticsSectionWrapper from "../analytics-section-wrapper";
import { ChartLoader } from "../loaders";
import { BDMessage, useBDInsightsKey, useScopedProjectFields } from "./common";

const analyticsService = new AnalyticsService();

type TByField = {
  field_id: string;
  data: { key: string; name: string; leads: number; wins: number }[];
};

type Props = {
  /** The single-select custom field to group by, resolved by name. */
  fieldName: string;
  title: string;
};

export const LeadsWinsByField = observer(function LeadsWinsByField(props: Props) {
  const { fieldName, title } = props;
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const field = scopedProjectId ? findField(fieldName, "single_select") : undefined;
  const fieldId = field?.id;

  const { data, isLoading } = useSWR(
    ws && fieldId ? `bd-by-field-${ws}-${fieldId}-${keyFragment}` : null,
    ws && fieldId
      ? () =>
          analyticsService.getBDInsights<TByField>(ws, {
            type: "by-field",
            field_id: fieldId,
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const chartData = useMemo<TChartData<string, string>[]>(
    () => (data?.data ?? []).map((item) => ({ name: item.name, leads: item.leads, wins: item.wins })),
    [data]
  );

  const bars: TBarItem<string>[] = useMemo(
    () => [
      {
        key: "leads",
        label: "Leads",
        stackId: "leads",
        fill: "#1192E8",
        textClassName: "",
        showPercentage: false,
        showTopBorderRadius: () => true,
        showBottomBorderRadius: () => true,
      },
      {
        key: "wins",
        label: "Wins",
        stackId: "wins",
        fill: "#198038",
        textClassName: "",
        showPercentage: false,
        showTopBorderRadius: () => true,
        showBottomBorderRadius: () => true,
      },
    ],
    []
  );

  const renderBody = () => {
    // Guard 1: needs exactly one project (custom fields are project-scoped).
    if (!scopedProjectId) {
      return (
        <BDMessage
          title="Select a single project"
          description={`Leads & wins by ${fieldName} needs one project in focus, because custom fields are project-scoped.`}
        />
      );
    }
    if (isFieldsLoading) return <ChartLoader />;
    // Guard 2: field missing/renamed — explicit help state, never a blank chart.
    if (!field) {
      return (
        <BDMessage
          title={`Field "${fieldName}" not found`}
          description={`No active single-select field named "${fieldName}" in this project. Check the project's custom-field settings (it may have been renamed or deactivated).`}
        />
      );
    }
    if (isLoading) return <ChartLoader />;
    if (!chartData.length) {
      return <BDMessage title="No leads" description="No leads matched the selected range." />;
    }
    return (
      <BarChart
        className="h-[350px] w-full"
        data={chartData}
        bars={bars}
        margin={{ bottom: 30 }}
        xAxis={{ key: "name", label: fieldName, dy: 20 }}
        yAxis={{ key: "leads", label: "Leads", offset: -40, dx: -20 }}
      />
    );
  };

  return (
    <AnalyticsSectionWrapper title={title} className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default LeadsWinsByField;
