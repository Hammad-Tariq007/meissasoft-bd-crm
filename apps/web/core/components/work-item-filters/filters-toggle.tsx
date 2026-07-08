/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import type { EIssuesStoreType } from "@plane/types";
// components
import { FiltersToggle } from "@/components/rich-filters/filters-toggle";
// hooks
import { useWorkItemFilters } from "@/hooks/store/work-item-filters/use-work-item-filters";

type TWorkItemFiltersToggleProps = {
  entityType: EIssuesStoreType;
  entityId: string;
};

export const WorkItemFiltersToggle = observer(function WorkItemFiltersToggle(props: TWorkItemFiltersToggleProps) {
  const { entityType, entityId } = props;
  // store hooks
  const { getFilter } = useWorkItemFilters();
  // derived values
  const filter = getFilter(entityType, entityId);

  // Leads always carry a default date scope, so the "filters applied" highlight would be permanently
  // on; render the toggle neutral like the other toolbar buttons instead.
  return <FiltersToggle filter={filter} showActiveState={false} />;
});
