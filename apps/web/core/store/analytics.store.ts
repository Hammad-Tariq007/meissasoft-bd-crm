/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { ANALYTICS_DURATION_FILTER_OPTIONS } from "@plane/constants";
import type { TAnalyticsFilterParams, TAnalyticsTabsBase } from "@plane/types";

type DurationType = (typeof ANALYTICS_DURATION_FILTER_OPTIONS)[number]["value"];

// Only the created-date scoping params, extracted so every chart fetch shares
// the same serialization (see `dateFilterParams`).
type TAnalyticsDateParams = Pick<TAnalyticsFilterParams, "date_filter" | "start_date" | "end_date">;

export interface IBaseAnalyticsStore {
  //observables
  currentTab: TAnalyticsTabsBase;
  selectedProjects: string[];
  selectedDuration: DurationType;
  selectedStartDate: string | null;
  selectedEndDate: string | null;
  selectedCycle: string;
  selectedModule: string;
  isPeekView?: boolean;
  isEpic?: boolean;
  //computed
  selectedDurationLabel: string | null;
  dateFilterParams: TAnalyticsDateParams;

  //actions
  updateSelectedProjects: (projects: string[]) => void;
  updateSelectedDuration: (duration: DurationType) => void;
  updateSelectedDateRange: (startDate: string | null, endDate: string | null) => void;
  updateSelectedCycle: (cycle: string) => void;
  updateSelectedModule: (module: string) => void;
  updateIsPeekView: (isPeekView: boolean) => void;
  updateIsEpic: (isEpic: boolean) => void;
}

export abstract class BaseAnalyticsStore implements IBaseAnalyticsStore {
  //observables
  currentTab: TAnalyticsTabsBase = "overview";
  selectedProjects: string[] = [];
  // "all_time" is the default and sends no date scope, so nothing is filtered
  // until a range is chosen.
  selectedDuration: DurationType = "all_time";
  selectedStartDate: string | null = null;
  selectedEndDate: string | null = null;
  selectedCycle: string = "";
  selectedModule: string = "";
  isPeekView: boolean = false;
  isEpic: boolean = false;
  constructor() {
    makeObservable(this, {
      // observables
      currentTab: observable.ref,
      selectedDuration: observable.ref,
      selectedStartDate: observable.ref,
      selectedEndDate: observable.ref,
      selectedProjects: observable,
      selectedCycle: observable.ref,
      selectedModule: observable.ref,
      isPeekView: observable.ref,
      isEpic: observable.ref,
      // computed
      selectedDurationLabel: computed,
      dateFilterParams: computed,
      // actions
      updateSelectedProjects: action,
      updateSelectedDuration: action,
      updateSelectedDateRange: action,
      updateSelectedCycle: action,
      updateSelectedModule: action,
      updateIsPeekView: action,
      updateIsEpic: action,
    });
  }

  get selectedDurationLabel() {
    return ANALYTICS_DURATION_FILTER_OPTIONS.find((item) => item.value === this.selectedDuration)?.name ?? null;
  }

  // Serializes the current date selection into query params for the analytics
  // endpoints. "all_time" -> no params (no scoping); "custom" -> explicit
  // bounds (only once both are set); any other preset -> just its key.
  get dateFilterParams(): TAnalyticsDateParams {
    if (!this.selectedDuration || this.selectedDuration === "all_time") return {};
    if (this.selectedDuration === "custom") {
      if (!this.selectedStartDate || !this.selectedEndDate) return {};
      return {
        date_filter: "custom",
        start_date: this.selectedStartDate,
        end_date: this.selectedEndDate,
      };
    }
    return { date_filter: this.selectedDuration };
  }

  updateSelectedProjects = (projects: string[]) => {
    try {
      runInAction(() => {
        this.selectedProjects = projects;
      });
    } catch (error) {
      console.error("Failed to update selected project");
      throw error;
    }
  };

  updateSelectedDuration = (duration: DurationType) => {
    try {
      runInAction(() => {
        this.selectedDuration = duration;
        // Leaving the custom range clears its bounds so a stale range never
        // lingers behind a preset selection.
        if (duration !== "custom") {
          this.selectedStartDate = null;
          this.selectedEndDate = null;
        }
      });
    } catch (error) {
      console.error("Failed to update selected duration");
      throw error;
    }
  };

  updateSelectedDateRange = (startDate: string | null, endDate: string | null) => {
    runInAction(() => {
      this.selectedStartDate = startDate;
      this.selectedEndDate = endDate;
    });
  };

  updateSelectedCycle = (cycle: string) => {
    runInAction(() => {
      this.selectedCycle = cycle;
    });
  };

  updateSelectedModule = (module: string) => {
    runInAction(() => {
      this.selectedModule = module;
    });
  };

  updateIsPeekView = (isPeekView: boolean) => {
    runInAction(() => {
      this.isPeekView = isPeekView;
    });
  };

  updateIsEpic = (isEpic: boolean) => {
    runInAction(() => {
      this.isEpic = isEpic;
    });
  };
}
