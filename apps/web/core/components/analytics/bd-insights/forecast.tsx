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
import { BDCaption, BDMessage, useBDInsightsKey, useScopedProjectFields } from "./common";

const analyticsService = new AnalyticsService();

const RATE_FIELD = "Rate";
const WEEKS_FIELD = "No. of Weeks";
const CONTRACT_FIELD = "Contract Type";
const LOSS_REASON_FIELD = "Loss Reason";

const BLUE = "#1192E8";

const money = (value: number | null): string => {
  if (value === null) return "—";
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `$${value.toFixed(0)}`;
};

type TForecastStage = { name: string; win_prob: number; open_count: number; weighted_value: number };
type TForecast = {
  revenue_enabled: boolean;
  hours_per_week: number;
  forecast_value: number | null;
  open_total: number;
  open_valued: number;
  open_excluded: number;
  stages: TForecastStage[];
};

/**
 * Weighted-pipeline forecast: total estimated value of open leads, each scaled by
 * its stage's win probability. The per-stage breakdown shows where the forecast
 * comes from. Every figure is an estimate (deal-value proxy + snapshot win rates).
 */
export const PipelineForecast = observer(function PipelineForecast() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const rateField = scopedProjectId ? findField(RATE_FIELD, "text") : undefined;
  const weeksField = scopedProjectId ? findField(WEEKS_FIELD, "number") : undefined;
  const contractField = scopedProjectId ? findField(CONTRACT_FIELD, "single_select") : undefined;
  const fieldKey = `${rateField?.id ?? "-"}-${weeksField?.id ?? "-"}-${contractField?.id ?? "-"}`;

  const { data, isLoading } = useSWR(
    ws ? `bd-forecast-${ws}-${fieldKey}-${keyFragment}` : null,
    ws
      ? () =>
          analyticsService.getBDInsights<TForecast>(ws, {
            type: "forecast",
            ...(rateField?.id ? { rate_field_id: rateField.id } : {}),
            ...(weeksField?.id ? { weeks_field_id: weeksField.id } : {}),
            ...(contractField?.id ? { contract_field_id: contractField.id } : {}),
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const renderBody = () => {
    if (!scopedProjectId)
      return (
        <BDMessage
          title="Select a single project"
          description="The forecast needs one project in focus, because deal value comes from project-scoped custom fields."
        />
      );
    if (isFieldsLoading || isLoading) return <ChartLoader />;
    if (!data) return <BDMessage title="No data" description="No leads matched the selected range." />;

    const maxWeighted = Math.max(...data.stages.map((s) => s.weighted_value), 1);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-md border border-subtle bg-layer-1 p-5">
          <span className="text-11 tracking-wide text-tertiary uppercase">Weighted pipeline (est.)</span>
          <span className="text-28 font-bold text-primary">{money(data.forecast_value)}</span>
          <span className="text-11 text-tertiary">
            {data.open_total} open lead{data.open_total === 1 ? "" : "s"} · {data.open_valued} valued
            {data.open_excluded > 0 ? ` · ${data.open_excluded} excluded (unparseable rate)` : ""}
          </span>
        </div>
        {data.stages.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-subtle">
            <table className="w-full text-13">
              <thead className="border-b border-subtle text-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Stage</th>
                  <th className="px-3 py-2 text-right font-medium">Open</th>
                  <th className="px-3 py-2 text-right font-medium">Win prob.</th>
                  <th className="px-3 py-2 text-left font-medium">Weighted value (est.)</th>
                </tr>
              </thead>
              <tbody>
                {data.stages.map((stage) => (
                  <tr key={stage.name} className="border-b border-subtle last:border-b-0">
                    <td className="px-3 py-2 text-left text-primary">{stage.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{stage.open_count}</td>
                    <td className="px-3 py-2 text-right text-tertiary tabular-nums">{stage.win_prob}%</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-3.5 w-24 shrink-0 overflow-hidden rounded-sm bg-layer-1">
                          <div
                            className="h-full rounded-sm transition-all duration-500"
                            style={{
                              width: `${Math.max((stage.weighted_value / maxWeighted) * 100, 2)}%`,
                              backgroundColor: BLUE,
                            }}
                          />
                        </div>
                        <span className="text-primary tabular-nums">{money(stage.weighted_value)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <BDCaption>
          Estimate. Each open lead is weighted by its stage&apos;s win probability (a current-snapshot proxy: won ÷
          leads that reached the stage) × estimated deal value (Rate × {data.hours_per_week} h/week × weeks for Hourly,
          Rate as flat total for Fixed).
        </BDCaption>
      </div>
    );
  };

  return (
    <AnalyticsSectionWrapper title="Pipeline forecast" className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

type TLossRow = { key: string; name: string; count: number };
type TLossResponse = { field_id: string; total: number; data: TLossRow[] };

/** Why deals are lost — breakdown of lost leads by the "Loss Reason" field. */
export const LossReasons = observer(function LossReasons() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const field = scopedProjectId ? findField(LOSS_REASON_FIELD, "single_select") : undefined;
  const fieldId = field?.id;

  const { data, isLoading } = useSWR(
    ws && fieldId ? `bd-loss-reasons-${ws}-${fieldId}-${keyFragment}` : null,
    ws && fieldId
      ? () =>
          analyticsService.getBDInsights<TLossResponse>(ws, {
            type: "loss-reasons",
            field_id: fieldId,
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const renderBody = () => {
    if (!scopedProjectId)
      return (
        <BDMessage
          title="Select a single project"
          description="Loss reasons need one project in focus, because custom fields are project-scoped."
        />
      );
    if (isFieldsLoading) return <ChartLoader />;
    if (!field)
      return (
        <BDMessage
          title={`Add a "${LOSS_REASON_FIELD}" field`}
          description={`Create a single-select field named "${LOSS_REASON_FIELD}" (e.g. Price too high, Timing, Went with competitor, No budget, Ghosted, Not a fit, Other) in this project's custom-field settings, then set it on lost leads — the breakdown appears here.`}
        />
      );
    if (isLoading) return <ChartLoader />;
    const rows = data?.data ?? [];
    if (rows.length === 0 || (data?.total ?? 0) === 0)
      return <BDMessage title="No lost leads" description="No lost leads in the selected range." />;

    const total = data!.total;
    return (
      <>
        <BDCaption>Share of lost leads by reason. Lost = Lost / No Response / Disqualified.</BDCaption>
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => {
            const share = total ? Math.round((row.count / total) * 100) : 0;
            return (
              <div key={row.key} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-13 text-secondary" title={row.name}>
                  {row.name}
                </div>
                <div className="h-5 flex-1 overflow-hidden rounded-sm bg-layer-1">
                  <div
                    className="h-full rounded-sm transition-all duration-500"
                    style={{ width: `${Math.max(share, 3)}%`, backgroundColor: BLUE }}
                  />
                </div>
                <div className="flex w-20 shrink-0 items-baseline justify-end gap-1.5">
                  <span className="text-13 font-medium text-primary">{share}%</span>
                  <span className="text-11 text-tertiary">({row.count})</span>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <AnalyticsSectionWrapper title="Loss reasons" className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default PipelineForecast;
