/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Disclosure, Transition } from "@headlessui/react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ChevronRightIcon } from "@plane/propel/icons";
import { IconButton } from "@plane/propel/icon-button";
import type { TUserPresenceStatus } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";
// components
import { UserAvatar } from "@/components/common/user-avatar";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { usePresence } from "@/hooks/store/use-presence";

// online first, then away, then dnd (offline members are filtered out entirely)
const STATUS_ORDER: Record<TUserPresenceStatus, number> = { online: 0, away: 1, dnd: 2, offline: 9 };

// status -> dot color, mirrors the avatar indicator (offline never renders here)
const STATUS_DOT_COLOR: Record<TUserPresenceStatus, string> = {
  online: "#22c55e",
  away: "#f59e0b",
  dnd: "#ef4444",
  offline: "transparent",
};

/**
 * Sidebar "Active" section: members currently present (online / away / dnd) in the open
 * project — or, when not inside a project, across the workspace. A pure consumer of the
 * presence store, so it re-renders live as `statusMap` polls in / statuses change. Wrapped
 * in `observer` so the list stays in sync without any manual refetch.
 */
export const SidebarActiveMembers = observer(function SidebarActiveMembers() {
  // router params
  const { projectId } = useParams();
  // local state
  const [isOpen, setIsOpen] = useState(true);
  // store hooks
  const {
    getUserDetails,
    workspace: { workspaceMemberIds },
    project: { getProjectMemberIds },
  } = useMember();
  const { getUserStatus } = usePresence();

  const memberIds = (projectId ? getProjectMemberIds(projectId.toString(), true) : workspaceMemberIds) ?? [];
  const present = memberIds
    .map((id) => ({ id, status: getUserStatus(id) }))
    .filter((member) => member.status !== "offline");
  // `present` is a fresh array (map/filter), so the in-place sort is safe.
  // eslint-disable-next-line unicorn/no-array-sort
  present.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return (getUserDetails(a.id)?.display_name ?? "").localeCompare(getUserDetails(b.id)?.display_name ?? "");
  });

  // nothing to show yet (before the first poll, or truly no one present) -> hide the section
  if (present.length === 0) return null;

  return (
    <Disclosure as="div" className="flex flex-col" defaultOpen={isOpen}>
      <div className="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-placeholder hover:bg-layer-transparent-hover">
        <Disclosure.Button
          as="button"
          type="button"
          className="flex w-full items-center gap-1 text-left text-13 font-semibold whitespace-nowrap text-placeholder"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span className="text-13 font-semibold">Active</span>
          <span className="text-11 font-medium text-placeholder">{present.length}</span>
        </Disclosure.Button>
        <IconButton
          variant="ghost"
          size="sm"
          icon={ChevronRightIcon}
          onClick={() => setIsOpen((prev) => !prev)}
          className="text-placeholder"
          iconClassName={cn("transition-transform", { "rotate-90": isOpen })}
        />
      </div>
      <Transition
        show={isOpen}
        enter="transition duration-100 ease-out"
        enterFrom="transform scale-95 opacity-0"
        enterTo="transform scale-100 opacity-100"
        leave="transition duration-75 ease-out"
        leaveFrom="transform scale-100 opacity-100"
        leaveTo="transform scale-95 opacity-0"
      >
        <Disclosure.Panel as="div" className="flex flex-col gap-0.5" static>
          {present.map(({ id, status }) => {
            const userDetails = getUserDetails(id);
            return (
              <div
                key={id}
                className="flex items-center gap-2 rounded-sm px-2 py-1 text-13 text-secondary hover:bg-layer-transparent-hover"
              >
                <UserAvatar
                  userId={id}
                  src={getFileURL(userDetails?.avatar_url ?? "")}
                  name={userDetails?.display_name}
                  size="sm"
                />
                <span className="min-w-0 flex-grow truncate">
                  {userDetails?.display_name ?? userDetails?.email ?? "Unknown"}
                </span>
                {/* live status dot, aligned under the section collapse arrow (mr offsets the
                    arrow's IconButton half-width so the dot centers beneath it) */}
                <span
                  className="mr-1.5 size-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_DOT_COLOR[status] }}
                />
              </div>
            );
          })}
        </Disclosure.Panel>
      </Transition>
    </Disclosure>
  );
});
