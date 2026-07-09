/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ArrowDown } from "lucide-react";
import useSWR from "swr";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local
import AnalyticsSectionWrapper from "../analytics-section-wrapper";
import { ChartLoader } from "../loaders";
import { BDCaption, BDMessage, StatTile, useBDInsightsKey } from "./common";

const analyticsService = new AnalyticsService();

type TFunnelStage = {
  key: string;
  name: string;
  group: string;
  count: number;
  reached: number;
  conversion_to_next: number | null;
};

type TFunnel = {
  assumption: string;
  entered_count: number;
  lost_count: number;
  biggest_leak_index: number | null;
  stages: TFunnelStage[];
};

const BLUE = "#1192E8";

export const ConversionFunnel = observer(function ConversionFunnel() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();

  const { data, isLoading } = useSWR(
    ws ? `bd-conversion-funnel-${ws}-${keyFragment}` : null,
    ws
      ? () =>
          analyticsService.getBDInsights<TFunnel>(ws, {
            type: "conversion-funnel",
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const renderBody = () => {
    if (isLoading) return <ChartLoader />;
    if (!data || data.stages.length === 0) {
      return <BDMessage title="No pipeline data" description="No leads with a pipeline stage in the selected range." />;
    }
    const entered = data.entered_count || 0;
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatTile label="Entered pipeline" value={String(entered)} hint="Leads currently active or won" />
          <StatTile label="Lost / dropped out" value={String(data.lost_count)} hint="Stage of exit not tracked" />
        </div>
        <div className="flex flex-col">
          {data.stages.map((stage, i) => {
            const widthPct = entered ? Math.max((stage.reached / entered) * 100, 4) : 0;
            const isLeak = data.biggest_leak_index === i;
            const nextReached = i < data.stages.length - 1 ? data.stages[i + 1].reached : null;
            const dropoff = nextReached !== null ? stage.reached - nextReached : null;
            return (
              <div key={stage.key} className="flex flex-col items-center">
                {/* funnel bar */}
                <div className="flex w-full items-center justify-center">
                  <div
                    className="flex h-11 items-center justify-between gap-3 rounded-md px-3 text-white transition-all duration-500"
                    style={{ width: `${widthPct}%`, backgroundColor: BLUE, minWidth: "8rem" }}
                    title={`${stage.name}: ${stage.reached} reached`}
                  >
                    <span className="truncate text-13 font-medium">{stage.name}</span>
                    <span className="shrink-0 text-13 font-semibold tabular-nums">{stage.reached}</span>
                  </div>
                </div>
                {/* connector: conversion % + drop-off to next stage */}
                {stage.conversion_to_next !== null && (
                  <div
                    className={`flex items-center gap-1.5 py-1 text-11 ${isLeak ? "text-danger font-semibold" : "text-tertiary"}`}
                  >
                    <ArrowDown className="size-3" />
                    <span>{stage.conversion_to_next}% advance</span>
                    {dropoff ? (
                      <span>
                        · {dropoff} dropped{isLeak ? " (biggest leak)" : ""}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <BDCaption>
          Current-snapshot funnel: a lead sitting in a later stage is counted as having passed the earlier ones. It
          reflects where active &amp; won leads are now, not historical transitions. Lost leads are shown separately
          because their exit stage isn’t tracked.
        </BDCaption>
      </div>
    );
  };

  return (
    <AnalyticsSectionWrapper title="Stage-conversion funnel" className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default ConversionFunnel;
