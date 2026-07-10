/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef } from "react";
import { observer } from "mobx-react";
// plane imports
import type { E_SORT_ORDER, TActivityFilters, EActivityFilterType } from "@plane/constants";
import { BASE_ACTIVITY_FILTER_TYPES, filterActivityOnSelectedFilters } from "@plane/constants";
import type { TCommentsOperations } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web components
import { IssueAdditionalPropertiesActivity } from "@/plane-web/components/issues/issue-details/issue-properties-activity";
import { IssueActivityWorklog } from "@/plane-web/components/issues/worklog/activity/root";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
  } = props;
  // store hooks
  const {
    activity: { getActivityAndCommentsByIssueId },
    comment: { getCommentById },
  } = useIssueDetail();
  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  // ---- read-receipts: report this comment thread as "seen", debounced ----
  // Fire one POST when the thread is on screen (IntersectionObserver) and again when the
  // comment count changes while visible. Never per-render/scroll; skipped when the tab is
  // hidden. Hooks must run before the early returns below.
  const rootRef = useRef<HTMLDivElement>(null);
  const isVisibleRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentCount = (activityAndComments ?? []).filter((item) => item.activity_type === "COMMENT").length;

  const scheduleMarkViewed = useCallback(() => {
    if (!activityOperations.markViewed) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void activityOperations.markViewed?.();
    }, 1500);
  }, [activityOperations]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        isVisibleRef.current = visible;
        if (visible) scheduleMarkViewed();
      },
      { threshold: 0.1 }
    );
    visibilityObserver.observe(el);
    return () => {
      visibilityObserver.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [scheduleMarkViewed]);

  // re-report when new comments land while the thread is on screen
  useEffect(() => {
    if (isVisibleRef.current) scheduleMarkViewed();
  }, [commentCount, scheduleMarkViewed]);

  if (!activityAndComments) return <IssueActivityLoader />;

  if (activityAndComments.length <= 0) return null;

  const filteredActivityAndComments = filterActivityOnSelectedFilters(activityAndComments, selectedFilters);

  return (
    <div ref={rootRef}>
      {filteredActivityAndComments.map((activityComment, index) => {
        const comment = getCommentById(activityComment.id);
        return activityComment.activity_type === "COMMENT" ? (
          <CommentCard
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            entityId={issueId}
            comment={comment}
            activityOperations={activityOperations}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
            showAccessSpecifier={!!showAccessSpecifier}
            showCopyLinkOption={!isIntakeIssue}
            disabled={disabled}
            projectId={projectId}
            enableReplies
          />
        ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
          <IssueActivityItem
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY" ? (
          <IssueAdditionalPropertiesActivity
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "WORKLOG" ? (
          <IssueActivityWorklog
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            activityComment={activityComment}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : (
          <></>
        );
      })}
    </div>
  );
});
