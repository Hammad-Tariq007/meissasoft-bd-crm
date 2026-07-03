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
import { AreaChart } from "@plane/propel/charts/area-chart";
import type { TAreaItem, TChartData } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local
import AnalyticsSectionWrapper from "../analytics-section-wrapper";
import { ChartLoader } from "../loaders";
import { BDCaption, BDMessage, useBDInsightsKey } from "./common";

const analyticsService = new AnalyticsService();

type TTrend = {
  data: { week: string; created: number; wins: number }[];
};

export const TrendOverTime = observer(function TrendOverTime() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();

  const { data, isLoading } = useSWR(
    ws ? `bd-trend-${ws}-${keyFragment}` : null,
    ws
      ? () =>
          analyticsService.getBDInsights<TTrend>(ws, {
            type: "trend",
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const chartData = useMemo<TChartData<string, string>[]>(
    () =>
      (data?.data ?? []).map((item) => ({
        name: renderFormattedDate(item.week) ?? item.week,
        created: item.created,
        wins: item.wins,
      })),
    [data]
  );

  const areas: TAreaItem<string>[] = useMemo(
    () => [
      {
        key: "created",
        label: "Leads created",
        fill: "#1192E833",
        fillOpacity: 1,
        stackId: "created",
        showDot: false,
        smoothCurves: true,
        strokeColor: "#1192E8",
        strokeOpacity: 1,
      },
      {
        key: "wins",
        label: "Wins",
        fill: "#19803833",
        fillOpacity: 1,
        stackId: "wins",
        showDot: false,
        smoothCurves: true,
        strokeColor: "#198038",
        strokeOpacity: 1,
      },
    ],
    []
  );

  return (
    <AnalyticsSectionWrapper title="Trend over time" className="col-span-1">
      <BDCaption>Leads created per week (by created date) and wins per week (by win date).</BDCaption>
      {isLoading ? (
        <ChartLoader />
      ) : chartData.length > 0 ? (
        <AreaChart
          className="h-[350px] w-full"
          data={chartData}
          areas={areas}
          xAxis={{ key: "name", label: "Week" }}
          yAxis={{ key: "created", label: "Count", offset: -40, dx: -20 }}
          legend={{ align: "left", verticalAlign: "bottom", layout: "horizontal" }}
        />
      ) : (
        <BDMessage title="No leads" description="No leads matched the selected range." />
      )}
    </AnalyticsSectionWrapper>
  );
});

export default TrendOverTime;
