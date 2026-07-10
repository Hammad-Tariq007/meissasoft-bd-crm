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
import type { TUserPresence, TUserPresenceStatus } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";
// components
import { UserAvatar } from "@/components/common/user-avatar";
// helpers
import { getPresenceLabel } from "@/helpers/presence.helper";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { usePresence } from "@/hooks/store/use-presence";

// online first, then away, then dnd, then offline last
const STATUS_ORDER: Record<TUserPresenceStatus, number> = { online: 0, away: 1, dnd: 2, offline: 3 };

// status -> dot color, mirrors the avatar indicator (offline shows no colored dot)
const STATUS_DOT_COLOR: Record<TUserPresenceStatus, string> = {
  online: "#22c55e",
  away: "#f59e0b",
  dnd: "#ef4444",
  offline: "transparent",
};

type TMemberRow = { id: string; presence: TUserPresence };

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
  const { getUserPresence } = usePresence();

  const memberIds = (projectId ? getProjectMemberIds(projectId.toString(), true) : workspaceMemberIds) ?? [];
  // Only members with a durable presence trail appear (active OR recently offline);
  // members never seen are omitted.
  const rows: TMemberRow[] = memberIds
    .map((id) => ({ id, presence: getUserPresence(id) }))
    .filter((row): row is TMemberRow => !!row.presence);

  const nameOf = (id: string) => getUserDetails(id)?.display_name ?? getUserDetails(id)?.email ?? "";

  // active = online/away/dnd, ordered online -> away -> dnd then name.
  // `rows` derivatives are fresh arrays, so the in-place sorts are safe.
  const active = rows.filter((r) => r.presence.status !== "offline");
  // eslint-disable-next-line unicorn/no-array-sort
  active.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.presence.status] - STATUS_ORDER[b.presence.status];
    return byStatus !== 0 ? byStatus : nameOf(a.id).localeCompare(nameOf(b.id));
  });
  // offline members, most-recently-seen first.
  const offline = rows.filter((r) => r.presence.status === "offline");
  // eslint-disable-next-line unicorn/no-array-sort
  offline.sort((a, b) => (b.presence.last_seen ?? 0) - (a.presence.last_seen ?? 0));

  // nothing to show yet (before the first poll, or no one ever seen) -> hide the section
  if (active.length === 0 && offline.length === 0) return null;

  const renderRow = ({ id, presence }: TMemberRow, muted: boolean) => {
    const userDetails = getUserDetails(id);
    return (
      <div
        key={id}
        className={cn(
          "flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-layer-transparent-hover",
          muted ? "opacity-60" : ""
        )}
      >
        <UserAvatar
          userId={id}
          src={getFileURL(userDetails?.avatar_url ?? "")}
          name={userDetails?.display_name}
          size="sm"
        />
        <div className="flex min-w-0 flex-grow flex-col">
          <span className="truncate text-13 text-secondary">
            {userDetails?.display_name ?? userDetails?.email ?? "Unknown"}
          </span>
          <span className="truncate text-11 text-placeholder">{getPresenceLabel(presence)}</span>
        </div>
        <span
          className="mr-1.5 size-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: STATUS_DOT_COLOR[presence.status] }}
        />
      </div>
    );
  };

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
          <span className="text-11 font-medium text-placeholder">{active.length}</span>
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
          {active.map((row) => renderRow(row, false))}
          {/* keep offline members below a subtle divider, greyed, most-recently-seen first */}
          {offline.length > 0 && (
            <>
              {active.length > 0 && <div className="mx-2 my-1 border-t border-subtle" />}
              {offline.map((row) => renderRow(row, true))}
            </>
          )}
        </Disclosure.Panel>
      </Transition>
    </Disclosure>
  );
});
