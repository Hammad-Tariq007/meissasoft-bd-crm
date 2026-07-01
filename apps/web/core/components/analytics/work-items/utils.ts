/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane package imports
import type { ChartYAxisMetric, IState, TChartDimension } from "@plane/types";
import { ChartXAxisProperty } from "@plane/types";

interface ParamsProps {
  x_axis: TChartDimension;
  y_axis: ChartYAxisMetric;
  group_by?: TChartDimension;
}

const colorFromValue = (value: string, baseColors: string[]): string => {
  const index = Math.abs(value.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % baseColors.length;
  return baseColors[index];
};

export const generateBarColor = (
  value: string | null | undefined,
  params: ParamsProps,
  baseColors: string[],
  workspaceStates?: IState[]
): string => {
  if (!value) return baseColors[0];
  let color = baseColors[0];
  // Priority
  if (params.x_axis === ChartXAxisProperty.PRIORITY) {
    color =
      value === "urgent"
        ? "#ef4444"
        : value === "high"
          ? "#f97316"
          : value === "medium"
            ? "#eab308"
            : value === "low"
              ? "#22c55e"
              : "#ced4da";
  }

  // State
  if (params.x_axis === ChartXAxisProperty.STATES) {
    if (workspaceStates && workspaceStates.length > 0) {
      const state = workspaceStates.find((s) => s.id === value);
      if (state) {
        color = state.color;
      } else {
        color = colorFromValue(value, baseColors);
      }
    }
  }

  // Custom-field dimension: spread colors deterministically across option values.
  if (typeof params.x_axis === "string" && params.x_axis.startsWith("CUSTOM_FIELD_")) {
    color = colorFromValue(value, baseColors);
  }

  return color;
};
