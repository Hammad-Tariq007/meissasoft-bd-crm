/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import type { TUserPresenceStatus } from "@plane/types";
import { getFileURL } from "@plane/utils";
// components
import { UserAvatar } from "@/components/common/user-avatar";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { usePresence } from "@/hooks/store/use-presence";

// online first, then away, then dnd (offline is filtered out entirely)
const STATUS_ORDER: Record<TUserPresenceStatus, number> = { online: 0, away: 1, dnd: 2, offline: 9 };
const MAX_AVATARS = 5;

type Props = {
  projectId: string;
};

/**
 * A pure consumer of the presence store: the project's currently-present members (online / away /
 * dnd) shown as a compact, non-overlapping row of dotted avatars plus an "N active" count in the
 * issues header. It observes `statusMap`, so it re-renders live as presence polls in / DND toggles.
 */
export const ActiveUsersIndicator = observer(function ActiveUsersIndicator({ projectId }: Props) {
  const {
    getUserDetails,
    project: { getProjectMemberIds },
  } = useMember();
  const { getUserStatus } = usePresence();

  const memberIds = getProjectMemberIds(projectId, true) ?? [];
  const present = memberIds
    .map((id) => ({ id, status: getUserStatus(id) }))
    .filter((member) => member.status !== "offline");
  // `present` is already a fresh array (map/filter), so the in-place sort is safe.
  // eslint-disable-next-line unicorn/no-array-sort
  present.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return (getUserDetails(a.id)?.display_name ?? "").localeCompare(getUserDetails(b.id)?.display_name ?? "");
  });

  if (present.length === 0) return null;

  const shown = present.slice(0, MAX_AVATARS);
  const overflow = present.length - shown.length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {shown.map(({ id }) => {
          const userDetails = getUserDetails(id);
          return (
            <UserAvatar
              key={id}
              userId={id}
              src={getFileURL(userDetails?.avatar_url ?? "")}
              name={userDetails?.display_name}
              size="sm"
            />
          );
        })}
        {overflow > 0 && (
          <span className="grid h-4 w-4 place-items-center rounded-full bg-layer-3 text-9 text-tertiary">
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-13 whitespace-nowrap text-tertiary">{present.length} active</span>
    </div>
  );
});
