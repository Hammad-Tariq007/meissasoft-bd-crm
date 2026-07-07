/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ComponentProps } from "react";
import { observer } from "mobx-react";
// plane imports
import type { TUserPresenceStatus } from "@plane/types";
import { Avatar } from "@plane/ui";
// hooks
import { useUserStatus } from "@/hooks/store/use-presence";

// Presence status -> dot color. Offline maps to `undefined` == no dot (by design).
const STATUS_COLOR: Record<TUserPresenceStatus, string | undefined> = {
  online: "#22c55e", // green
  away: "#f59e0b", // amber
  dnd: "#ef4444", // red
  offline: undefined,
};

const STATUS_LABEL: Record<TUserPresenceStatus, string> = {
  online: "Online",
  away: "Away",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

type TUserAvatarProps = ComponentProps<typeof Avatar> & {
  userId: string | undefined;
  /** Suppress the status dot (e.g. inside an overlapping AvatarGroup stack). */
  showStatus?: boolean;
};

/**
 * Avatar for a specific user that overlays their live presence status dot. It renders the exact
 * same avatar as `@plane/ui` Avatar (same props) and only adds the dot — resolving userId -> status
 * here keeps `@plane/ui` generic. Must stay an `observer` so the dot updates as presence polls in.
 */
export const UserAvatar = observer(function UserAvatar(props: TUserAvatarProps) {
  const { userId, showStatus = true, ...avatarProps } = props;
  const status = useUserStatus(userId);
  const statusColor = showStatus ? STATUS_COLOR[status] : undefined;
  return (
    <Avatar {...avatarProps} statusColor={statusColor} statusTitle={statusColor ? STATUS_LABEL[status] : undefined} />
  );
});
