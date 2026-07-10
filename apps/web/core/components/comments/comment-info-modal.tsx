/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import type { TCommentsOperations, TIssueComment } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { calculateTimeAgoShort, getFileURL, renderFormattedDate, renderFormattedTime } from "@plane/utils";
// components
import { UserAvatar } from "@/components/common/user-avatar";
// hooks
import { useMember } from "@/hooks/store/use-member";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  comment: TIssueComment;
  activityOperations: TCommentsOperations;
};

/**
 * "Message info" for a comment (WhatsApp-style read-receipts). Author-only — the caller only
 * mounts this for the comment's author, and the backend independently enforces author-only
 * (403 otherwise). Lists which workspace members have seen the comment and when.
 */
export const CommentInfoModal = observer(function CommentInfoModal(props: Props) {
  const { isOpen, onClose, comment, activityOperations } = props;
  const { getUserDetails } = useMember();

  const { data, isLoading, error } = useSWR(
    isOpen && activityOperations.getCommentInfo ? `COMMENT_INFO_${comment.id}` : null,
    () => activityOperations.getCommentInfo?.(comment.id),
    { revalidateOnFocus: false }
  );

  const renderBody = () => {
    if (isLoading) return <div className="px-1 py-8 text-center text-13 text-tertiary">Loading…</div>;
    if (error)
      return <div className="text-danger px-1 py-8 text-center text-13">Couldn’t load info. Please try again.</div>;
    if (!data || data.total === 0)
      return (
        <div className="rounded-md border border-subtle px-4 py-10 text-center">
          <p className="text-13 font-medium text-primary">No one has seen this yet</p>
          <p className="mt-0.5 text-11 text-tertiary">You’ll see who’s read it here.</p>
        </div>
      );
    return (
      <div className="flex flex-col gap-0.5">
        <div className="mb-1 text-11 font-medium tracking-wide text-tertiary uppercase">Seen by {data.total}</div>
        {data.seen_by.map((row) => {
          const user = getUserDetails(row.member_id);
          return (
            <div
              key={row.member_id}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-layer-transparent-hover"
            >
              <UserAvatar userId={row.member_id} src={getFileURL(user?.avatar_url ?? "")} name={user?.display_name} />
              <div className="flex min-w-0 flex-grow flex-col">
                <span className="truncate text-13 text-primary">{user?.display_name ?? user?.email ?? "Unknown"}</span>
                <span className="text-11 text-tertiary">
                  {renderFormattedDate(row.seen_at)}, {renderFormattedTime(row.seen_at)}
                </span>
              </div>
              <span className="shrink-0 text-11 text-tertiary">{calculateTimeAgoShort(row.seen_at)} ago</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.MD}>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-16 font-semibold text-primary">Message info</h3>
          <p className="text-11 text-tertiary">Who has seen this comment.</p>
        </div>
        {renderBody()}
      </div>
    </ModalCore>
  );
});
