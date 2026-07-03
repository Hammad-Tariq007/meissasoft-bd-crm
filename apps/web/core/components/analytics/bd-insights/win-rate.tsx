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

          {data.per_bd.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-subtle">
              <table className="w-full text-13">
                <thead className="border-b border-subtle text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">BD</th>
                    <th className="px-4 py-2 text-right font-medium">Won</th>
                    <th className="px-4 py-2 text-right font-medium">Closed</th>
                    <th className="px-4 py-2 text-right font-medium">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.per_bd.map((row) => (
                    <tr key={row.assignee_id} className="border-b border-subtle last:border-b-0">
                      <td className="px-4 py-2 text-left text-primary">{row.assignee_name}</td>
                      <td className="px-4 py-2 text-right">{row.won}</td>
                      <td className="px-4 py-2 text-right">{row.closed}</td>
                      <td className="px-4 py-2 text-right font-medium text-primary">{pct(row.win_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <BDMessage title="No per-BD data" description="No closed leads with an assignee in the selected range." />
          )}
        </div>
      ) : (
        <BDMessage title="No data" description="No leads matched the selected range." />
      )}
    </AnalyticsSectionWrapper>
  );
});

export default WinRateInsight;
