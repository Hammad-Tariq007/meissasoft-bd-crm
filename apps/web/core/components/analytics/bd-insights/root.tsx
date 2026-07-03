/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import AnalyticsWrapper from "../analytics-wrapper";
import { ConnectsEfficiency } from "./connects-efficiency";
import { LeadsWinsByField } from "./leads-wins-by-field";
import { StageDistribution } from "./stage-distribution";
import { TimeToCloseInsight } from "./time-to-close";
import { TrendOverTime } from "./trend";
import { WinRateInsight } from "./win-rate";

function BDInsights() {
  return (
    <AnalyticsWrapper i18nTitle="BD Insights">
      <div className="flex flex-col gap-14">
        <WinRateInsight />
        <StageDistribution />
        <TimeToCloseInsight />
        <div className="grid grid-cols-1 gap-14 md:grid-cols-2">
          <LeadsWinsByField fieldName="Profile" title="Leads & wins by Profile" />
          <LeadsWinsByField fieldName="Country" title="Leads & wins by Country" />
        </div>
        <ConnectsEfficiency />
        <TrendOverTime />
      </div>
    </AnalyticsWrapper>
  );
}

export { BDInsights };
