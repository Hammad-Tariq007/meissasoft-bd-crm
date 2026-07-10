/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane types
import { API_BASE_URL } from "@plane/constants";
import type { TIssueComment, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { FileUploadService } from "@/services/file-upload.service";

/** A single member's read-receipt for a comment: who saw it and when (ISO string). */
export type TCommentSeenBy = { member_id: string; seen_at: string };
export type TCommentInfoResponse = { total: number; seen_by: TCommentSeenBy[] };

export class IssueCommentService extends APIService {
  private fileUploadService: FileUploadService;
  private serviceType: TIssueServiceType;

  constructor(serviceType: TIssueServiceType = EIssueServiceType.ISSUES) {
    super(API_BASE_URL);
    // upload service
    this.fileUploadService = new FileUploadService();
    this.serviceType = serviceType;
  }

  async getIssueComments(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    params:
      | {
          created_at__gt: string;
        }
      | object = {}
  ): Promise<TIssueComment[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/history/`, {
      params: {
        activity_type: `${this.serviceType === EIssueServiceType.EPICS ? "epic-comment" : "issue-comment"}`,
        ...params,
      },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createIssueComment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueComment>
  ): Promise<TIssueComment> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async patchIssueComment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ): Promise<TIssueComment> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/${commentId}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Record that the current user has viewed this work item's comment thread (read-receipts).
   *  Fire debounced from the client — on thread-visible and when new comments arrive. */
  async markCommentsViewed(workspaceSlug: string, projectId: string, issueId: string): Promise<void> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/viewed/`,
      {}
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Author-only: who has seen a specific comment and when. Returns 403 for non-authors. */
  async getCommentInfo(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string
  ): Promise<TCommentInfoResponse> {
    return this.get(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/${commentId}/info/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteIssueComment(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string
  ): Promise<void> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/${this.serviceType}/${issueId}/comments/${commentId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
