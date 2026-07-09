/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import AnalyticsWrapper from "../analytics-wrapper";
import { BoostedEffectiveness } from "./boosted-effectiveness";
import { BDGroupHeading } from "./common";
import { ConnectsEfficiency } from "./connects-efficiency";
import { EconomicsBySegment } from "./connects-economics";
import { ConversionFunnel } from "./conversion-funnel";
import { LossReasons, PipelineForecast } from "./forecast";
import { LeadsWinsByField } from "./leads-wins-by-field";
import { StageDistribution } from "./stage-distribution";
import { TimeToCloseInsight } from "./time-to-close";
import { TrendOverTime } from "./trend";
import { CycleBySegment, SalesVelocity } from "./velocity";
import { WinRateByField } from "./win-rate-by-field";
import { WinRateInsight } from "./win-rate";

// The widget stack without the page wrapper, so it can be reused inside the
// project Analytics slide-over (WorkItemsModal) as well as the standalone page.
export function BDInsightsContent() {
  return (
    <div className="flex flex-col gap-14">
      {/* §1 — Win & Conversion */}
      <section className="flex flex-col gap-8">
        <BDGroupHeading
          title="Win & Conversion"
          subtitle="How often leads close, sliced by segment, and where the pipeline leaks"
        />
        <WinRateInsight />
        <div className="grid grid-cols-1 gap-14 md:grid-cols-2">
          <WinRateByField fieldName="Profile" title="Win rate by Profile" />
          <WinRateByField fieldName="Lead Source" title="Win rate by Lead Source" />
          <WinRateByField fieldName="Country" title="Win rate by Country" />
          <WinRateByField fieldName="Contract Type" title="Win rate by Contract Type" />
        </div>
        <ConversionFunnel />
        <StageDistribution />
      </section>

      {/* §2 — Connects Economics (our differentiator) */}
      <section className="flex flex-col gap-8">
        <BDGroupHeading
          title="Connects Economics"
          subtitle="What we spend in connects to win — where it's wasted, whether boosting pays off, and the revenue each connect returns"
        />
        <ConnectsEfficiency />
        <div className="grid grid-cols-1 gap-14 md:grid-cols-2">
          <EconomicsBySegment fieldName="Profile" title="Connects ROI by Profile" />
          <EconomicsBySegment fieldName="Country" title="Connects ROI by Country" />
        </div>
        <BoostedEffectiveness />
      </section>

      {/* §3 — Volume & Segments */}
      <section className="flex flex-col gap-8">
        <BDGroupHeading title="Volume & Segments" subtitle="How many leads land, and which segments they come from" />
        <div className="grid grid-cols-1 gap-14 md:grid-cols-2">
          <LeadsWinsByField fieldName="Profile" title="Leads & wins by Profile" />
          <LeadsWinsByField fieldName="Country" title="Leads & wins by Country" />
        </div>
      </section>

      {/* §4 — Velocity & Cycle */}
      <section className="flex flex-col gap-8">
        <BDGroupHeading
          title="Velocity & Cycle"
          subtitle="How fast the pipeline turns money — velocity in $/day, and how long deals take to close by segment"
        />
        <SalesVelocity />
        <TimeToCloseInsight />
        <div className="grid grid-cols-1 gap-14 md:grid-cols-2">
          <CycleBySegment fieldName="Profile" title="Cycle length by Profile" />
          <CycleBySegment fieldName="Country" title="Cycle length by Country" />
        </div>
        <TrendOverTime />
      </section>

      {/* §5 — Forecast */}
      <section className="flex flex-col gap-8">
        <BDGroupHeading title="Forecast" subtitle="Where the open pipeline is headed, and why deals are lost" />
        <div className="grid grid-cols-1 gap-14 md:grid-cols-2">
          <PipelineForecast />
          <LossReasons />
        </div>
      </section>
    </div>
  );
}

function BDInsights() {
  return (
    <AnalyticsWrapper i18nTitle="BD Insights">
      <BDInsightsContent />
    </AnalyticsWrapper>
  );
}

export { BDInsights };
