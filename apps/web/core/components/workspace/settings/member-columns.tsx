/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Disclosure } from "@headlessui/react";
// plane imports
import { ROLE, EUserPermissions, EUserPermissionsLevel, MEMBER_TRACKER_ELEMENTS } from "@plane/constants";
import { TrashIcon, SuspendedUserIcon } from "@plane/propel/icons";
import { Pill, EPillVariant, EPillSize } from "@plane/propel/pill";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IUser, IWorkspaceMember } from "@plane/types";
// plane ui
import { CustomSelect, PopoverMenu, ToggleSwitch } from "@plane/ui";
// helpers
import { getFileURL } from "@plane/utils";
// hooks
import { UserAvatar } from "@/components/common/user-avatar";
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions } from "@/hooks/store/user";


export interface RowData {
  member: IWorkspaceMember;
  role: EUserPermissions;
  is_active: boolean;
  // Present at runtime because the table casts IWorkspaceMember rows to RowData;
  // the flag sits on the membership (row), not on the nested user object.
  can_view_analytics?: boolean;
  // BD CRM team layer (Phase 1): "bd" | "dev" | null, and the team-lead flag.
  team?: string | null;
  is_team_lead?: boolean;
}

type NameProps = {
  rowData: RowData;
  workspaceSlug: string;
  isAdmin: boolean;
  currentUser: IUser | undefined;
  setRemoveMemberModal: (rowData: RowData) => void;
};

type AccountTypeProps = {
  rowData: RowData;
  workspaceSlug: string;
};

type AnalyticsAccessProps = {
  rowData: RowData;
  workspaceSlug: string;
};

export function NameColumn(props: NameProps) {
  const { rowData, workspaceSlug, isAdmin, currentUser, setRemoveMemberModal } = props;
  // derived values
  const { avatar_url, display_name, email, first_name, id, last_name } = rowData.member;
  const isSuspended = rowData.is_active === false;

  return (
    <Disclosure>
      {() => (
        <div className="group relative">
          <div className="flex w-72 items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-1 items-center gap-x-2 gap-y-2">
              {isSuspended ? (
                <div className="rounded-full bg-layer-1">
                  <SuspendedUserIcon className="size-6 text-placeholder" />
                </div>
              ) : (
                <Link href={`/${workspaceSlug}/profile/${id}`}>
                  <UserAvatar
                    userId={id}
                    src={getFileURL(avatar_url ?? "")}
                    name={display_name || email}
                    size="base"
                    showTooltip={false}
                    className="object-cover"
                  />
                </Link>
              )}
              <span className={isSuspended ? "text-placeholder" : ""}>
                {first_name} {last_name}
              </span>
            </div>

            {!isSuspended && (isAdmin || id === currentUser?.id) && (
              <PopoverMenu
                data={[""]}
                keyExtractor={(item) => item}
                popoverClassName="justify-end"
                buttonClassName="outline-none	origin-center rotate-90 size-8 aspect-square flex-shrink-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
                render={() => (
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-x-3"
                    onClick={() => setRemoveMemberModal(rowData)}
                    data-ph-element={MEMBER_TRACKER_ELEMENTS.WORKSPACE_MEMBER_TABLE_CONTEXT_MENU}
                  >
                    <TrashIcon className="size-3.5 align-middle" /> {id === currentUser?.id ? "Leave " : "Remove "}
                  </button>
                )}
              />
            )}
          </div>
        </div>
      )}
    </Disclosure>
  );
}

export const AccountTypeColumn = observer(function AccountTypeColumn(props: AccountTypeProps) {
  const { rowData, workspaceSlug } = props;
  // form info
  const {
    control,
    formState: { errors },
  } = useForm();
  // store hooks
  const { allowPermissions } = useUserPermissions();

  const {
    workspace: { updateMember },
  } = useMember();
  const { data: currentUser } = useUser();

  // derived values
  const isCurrentUser = currentUser?.id === rowData.member.id;
  const isAdminRole = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const isRoleNonEditable = isCurrentUser || !isAdminRole;
  const isSuspended = rowData.is_active === false;

  return (
    <>
      {isSuspended ? (
        <div className="flex w-32">
          <Pill variant={EPillVariant.DEFAULT} size={EPillSize.SM} className="border-none">
            Suspended
          </Pill>
        </div>
      ) : isRoleNonEditable ? (
        <div className="flex w-32">
          <span>{ROLE[rowData.role]}</span>
        </div>
      ) : (
        <Controller
          name="role"
          control={control}
          rules={{ required: "Role is required." }}
          render={({ field: { value } }) => (
            <CustomSelect
              value={value as EUserPermissions}
              onChange={async (selectedRole: EUserPermissions) => {
                if (!workspaceSlug) return;
                try {
                  await updateMember(workspaceSlug.toString(), rowData.member.id, {
                    role: selectedRole as unknown as EUserPermissions,
                  });
                } catch (err: unknown) {
                  const error = err as { error?: string | string[] };
                  const errorString = Array.isArray(error?.error) ? error.error[0] : error?.error;

                  setToast({
                    type: TOAST_TYPE.ERROR,
                    title: "Error!",
                    message: errorString ?? "An error occurred while updating member role. Please try again.",
                  });
                }
              }}
              label={
                <div className="flex">
                  <span>{ROLE[rowData.role]}</span>
                </div>
              }
              buttonClassName={`!px-0 !justify-start hover:bg-surface-1 ${errors.role ? "border-danger-strong" : "border-none"}`}
              className="w-32 rounded-md p-0"
              input
            >
              {Object.keys(ROLE).map((item) => (
                <CustomSelect.Option key={item} value={item as unknown as EUserPermissions}>
                  {ROLE[item as unknown as keyof typeof ROLE]}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          )}
        />
      )}
    </>
  );
});

/**
 * Owner-only toggle to grant/revoke a member's BD Insights analytics access.
 * This column is only ever rendered for the workspace owner (gated in
 * useMemberColumns), and the server independently enforces owner-only writes.
 */
export const AnalyticsAccessColumn = observer(function AnalyticsAccessColumn(props: AnalyticsAccessProps) {
  const { rowData, workspaceSlug } = props;
  const {
    workspace: { updateMemberAnalyticsAccess },
  } = useMember();
  const [isUpdating, setIsUpdating] = useState(false);

  if (rowData.is_active === false) return null;
  const enabled = !!rowData.can_view_analytics;

  return (
    <div className="flex w-32">
      <ToggleSwitch
        value={enabled}
        disabled={isUpdating || !workspaceSlug}
        onChange={async () => {
          if (!workspaceSlug) return;
          setIsUpdating(true);
          try {
            await updateMemberAnalyticsAccess(workspaceSlug.toString(), rowData.member.id, !enabled);
          } catch (err: unknown) {
            const error = err as { error?: string };
            setToast({
              type: TOAST_TYPE.ERROR,
              title: "Error!",
              message: error?.error ?? "Could not update analytics access. Please try again.",
            });
          } finally {
            setIsUpdating(false);
          }
        }}
      />
    </div>
  );
});

type TeamColumnProps = {
  rowData: RowData;
  workspaceSlug: string | string[] | undefined;
};

const TEAM_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: "Unassigned" },
  { value: "bd", label: "BD" },
  { value: "dev", label: "Dev" },
];

/**
 * Owner-only column: set a member's team (BD/Dev/unassigned) and team-lead flag.
 * Rendered only for the workspace owner (gated in useMemberColumns); the server
 * independently enforces owner-only writes and one-lead-per-team.
 */
export const TeamColumn = observer(function TeamColumn({ rowData, workspaceSlug }: TeamColumnProps) {
  const {
    workspace: { updateMemberTeam },
  } = useMember();
  const [isUpdating, setIsUpdating] = useState(false);

  if (rowData.is_active === false) return null;
  const team = rowData.team ?? null;
  const isLead = !!rowData.is_team_lead;
  const teamLabel = TEAM_OPTIONS.find((o) => o.value === team)?.label ?? "Unassigned";

  const apply = async (next: { team: string | null; is_team_lead: boolean }) => {
    if (!workspaceSlug) return;
    setIsUpdating(true);
    try {
      await updateMemberTeam(workspaceSlug.toString(), rowData.member.id, next);
    } catch (err: unknown) {
      const error = err as { error?: string };
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: error?.error ?? "Could not update team. Please try again.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <CustomSelect
        value={team}
        onChange={(value: string | null) =>
          // Clearing the team also clears the lead flag (a lead must have a team).
          apply({ team: value, is_team_lead: value ? isLead : false })
        }
        label={<span>{teamLabel}</span>}
        buttonClassName="!px-0 !justify-start hover:bg-surface-1 border-none"
        className="w-28 rounded-md p-0"
        disabled={isUpdating || !workspaceSlug}
        input
      >
        {TEAM_OPTIONS.map((option) => (
          <CustomSelect.Option key={option.label} value={option.value}>
            {option.label}
          </CustomSelect.Option>
        ))}
      </CustomSelect>
      <span className="text-xs text-custom-text-300 flex items-center gap-1.5">
        <ToggleSwitch
          value={isLead}
          disabled={isUpdating || !team}
          onChange={() => apply({ team, is_team_lead: !isLead })}
        />
        Lead
      </span>
    </div>
  );
});
