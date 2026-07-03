/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, type MutableRefObject } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { TIssue, IIssueDisplayProperties, IIssueMap } from "@plane/types";
// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import { KanbanIssueBlock } from "./block";

interface IssueBlocksListProps {
  sub_group_id: string;
  groupId: string;
  issuesMap: IIssueMap;
  issueIds: string[];
  displayProperties: IIssueDisplayProperties | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  canDropOverIssue: boolean;
  canDragIssuesInCurrentGrouping: boolean;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  isEpic?: boolean;
}

export const KanbanIssueBlocksList = observer(function KanbanIssueBlocksList(props: IssueBlocksListProps) {
  const {
    sub_group_id,
    groupId,
    issuesMap,
    issueIds,
    displayProperties,
    canDropOverIssue,
    canDragIssuesInCurrentGrouping,
    updateIssue,
    quickActions,
    canEditProperties,
    scrollableContainerRef,
    isEpic = false,
  } = props;

  const { workspaceSlug } = useParams();
  const { getProjectCustomFields, fetchCustomFieldValuesBulk } = useCustomField();

  // Bulk-load custom-field values for this column's work items in one request
  // per project (mirrors spreadsheet-table.tsx; avoids one request per card).
  // Board groups can span projects, so we batch ids by project_id and skip
  // projects with no active custom fields. Reading the store here (observer)
  // keeps `bulkKey` reactive, so the fetch re-runs once field definitions finish
  // loading. The bulk method marks value-less issues as loaded-empty, so cards
  // without values never trigger a per-card fetch.
  const projectsWithFields = new Set<string>();
  (issueIds ?? []).forEach((issueId) => {
    const projectId = issuesMap[issueId]?.project_id;
    if (projectId && (getProjectCustomFields(projectId) ?? []).some((field) => field.is_active)) {
      projectsWithFields.add(projectId);
    }
  });
  const bulkKey = `${(issueIds ?? []).join(",")}|${[...projectsWithFields].toSorted().join(",")}`;

  useEffect(() => {
    const ws = workspaceSlug?.toString();
    if (!ws || projectsWithFields.size === 0) return;
    const idsByProject: Record<string, string[]> = {};
    (issueIds ?? []).forEach((issueId) => {
      const projectId = issuesMap[issueId]?.project_id;
      if (projectId && projectsWithFields.has(projectId)) (idsByProject[projectId] ??= []).push(issueId);
    });
    Object.entries(idsByProject).forEach(([projectId, ids]) => fetchCustomFieldValuesBulk(ws, projectId, ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, bulkKey]);

  return (
    <>
      {issueIds && issueIds.length > 0 ? (
        <>
          {issueIds.map((issueId, index) => {
            if (!issueId) return null;

            let draggableId = issueId;
            if (groupId) draggableId = `${draggableId}__${groupId}`;
            if (sub_group_id) draggableId = `${draggableId}__${sub_group_id}`;

            return (
              <KanbanIssueBlock
                key={draggableId}
                issueId={issueId}
                groupId={groupId}
                subGroupId={sub_group_id}
                shouldRenderByDefault={index <= 10}
                issuesMap={issuesMap}
                displayProperties={displayProperties}
                updateIssue={updateIssue}
                quickActions={quickActions}
                draggableId={draggableId}
                canDropOverIssue={canDropOverIssue}
                canDragIssuesInCurrentGrouping={canDragIssuesInCurrentGrouping}
                canEditProperties={canEditProperties}
                scrollableContainerRef={scrollableContainerRef}
                isEpic={isEpic}
              />
            );
          })}
        </>
      ) : null}
    </>
  );
});
