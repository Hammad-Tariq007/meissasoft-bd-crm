/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local
import AnalyticsSectionWrapper from "../analytics-section-wrapper";
import { ChartLoader } from "../loaders";
import { BDMessage, StatTile, useBDInsightsKey } from "./common";
import { WinRateBars } from "./win-rate-bars";

const analyticsService = new AnalyticsService();

type TWinRateRow = {
  assignee_id: string;
  assignee_name: string;
  won: number;
  closed: number;
  win_rate: number | null;
};

type TWinRate = {
  overall: { won: number; closed: number; win_rate: number | null };
  per_bd: TWinRateRow[];
};

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

export const WinRateInsight = observer(function WinRateInsight() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();

  const { data, isLoading } = useSWR(
    ws ? `bd-win-rate-${ws}-${keyFragment}` : null,
    ws
      ? () =>
          analyticsService.getBDInsights<TWinRate>(ws, {
            type: "win-rate",
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  return (
    <AnalyticsSectionWrapper title="Win rate" className="col-span-1">
      {isLoading ? (
        <ChartLoader />
      ) : data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Overall win rate"
              value={pct(data.overall.win_rate)}
              hint={`${data.overall.won} won / ${data.overall.closed} closed`}
            />
            <StatTile label="Won" value={String(data.overall.won)} />
            <StatTile label="Closed (won + lost)" value={String(data.overall.closed)} />
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-13 font-medium text-primary">Win rate by BD</div>
            <WinRateBars
              rows={data.per_bd.map((row) => ({
                key: row.assignee_id,
                name: row.assignee_name,
                won: row.won,
                closed: row.closed,
                win_rate: row.win_rate,
              }))}
              emptyTitle="No per-BD data"
              emptyDescription="No closed leads with an assignee in the selected range."
            />
          </div>
        </div>
      ) : (
        <BDMessage title="No data" description="No leads matched the selected range." />
      )}
    </AnalyticsSectionWrapper>
  );
});

export default WinRateInsight;
