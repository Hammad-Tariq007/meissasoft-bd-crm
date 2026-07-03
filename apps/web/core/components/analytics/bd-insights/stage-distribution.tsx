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
import { BDCaption, BDMessage, useBDInsightsKey } from "./common";

const analyticsService = new AnalyticsService();

type TStageDistribution = {
  data: { key: string; name: string; group: string; count: number }[];
};

export const StageDistribution = observer(function StageDistribution() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();

  const { data, isLoading } = useSWR(
    ws ? `bd-stage-distribution-${ws}-${keyFragment}` : null,
    ws
      ? () =>
          analyticsService.getBDInsights<TStageDistribution>(ws, {
            type: "funnel",
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const chartData = useMemo<TChartData<string, string>[]>(
    () => (data?.data ?? []).map((item) => ({ name: item.name, count: item.count })),
    [data]
  );

  const bars: TBarItem<string>[] = useMemo(
    () => [
      {
        key: "count",
        label: "Leads",
        stackId: "bar-one",
        fill: "#1192E8",
        textClassName: "",
        showPercentage: false,
        showTopBorderRadius: () => true,
        showBottomBorderRadius: () => true,
      },
    ],
    []
  );

  return (
    <AnalyticsSectionWrapper title="Current distribution by stage" className="col-span-1">
      <BDCaption>Snapshot of where leads currently sit — not a historical funnel or drop-off.</BDCaption>
      {isLoading ? (
        <ChartLoader />
      ) : chartData.length > 0 ? (
        <BarChart
          className="h-[350px] w-full"
          data={chartData}
          bars={bars}
          margin={{ bottom: 30 }}
          xAxis={{ key: "name", label: "Stage", dy: 20 }}
          yAxis={{ key: "count", label: "Leads", offset: -40, dx: -20 }}
        />
      ) : (
        <BDMessage title="No leads" description="No leads matched the selected range." />
      )}
    </AnalyticsSectionWrapper>
  );
});

export default StageDistribution;
