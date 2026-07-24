/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { CircleMinus } from "lucide-react";
import { Disclosure } from "@headlessui/react";
// plane imports
import { ROLE, EUserPermissions, MEMBER_TRACKER_ELEMENTS } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EUserProjectRoles, IUser, IWorkspaceMember, TProjectMembership } from "@plane/types";
import { CustomMenu, CustomSearchSelect, CustomSelect } from "@plane/ui";
import { getFileURL } from "@plane/utils";
// hooks
import { UserAvatar } from "@/components/common/user-avatar";
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// services
import { WorkspaceService } from "@/services/workspace.service";

const workspaceService = new WorkspaceService();

export interface RowData extends Pick<TProjectMembership, "original_role"> {
  member: IWorkspaceMember;
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
  currentProjectRole: EUserPermissions | undefined;
  workspaceSlug: string;
  projectId: string;
};

export function NameColumn(props: NameProps) {
  const { rowData, workspaceSlug, isAdmin, currentUser, setRemoveMemberModal } = props;
  // derived values
  const { avatar_url, display_name, email, first_name, id, last_name } = rowData.member;

  return (
    <Disclosure>
      {({}) => (
        <div className="group relative">
          <div className="flex w-72 items-center gap-2">
            <div className="flex flex-1 items-center gap-x-2 gap-y-2">
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
              {first_name} {last_name}
            </div>
            {(isAdmin || id === currentUser?.id) && (
              <CustomMenu
                ellipsis
                buttonClassName="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                optionsClassName="p-1.5"
                placement="bottom-end"
              >
                <CustomMenu.MenuItem>
                  <div
                    className="flex cursor-pointer items-center gap-x-1 font-medium text-danger-primary"
                    data-ph-element={MEMBER_TRACKER_ELEMENTS.PROJECT_MEMBER_TABLE_CONTEXT_MENU}
                    onClick={() => setRemoveMemberModal(rowData)}
                  >
                    <CircleMinus className="size-3.5 flex-shrink-0" />
                    {rowData.member?.id === currentUser?.id ? "Leave " : "Remove "}
                  </div>
                </CustomMenu.MenuItem>
              </CustomMenu>
            )}
          </div>
        </div>
      )}
    </Disclosure>
  );
}

export const AccountTypeColumn = observer(function AccountTypeColumn(props: AccountTypeProps) {
  const { rowData, projectId, workspaceSlug } = props;
  // store hooks
  const {
    project: { updateMemberRole },
    workspace: { getWorkspaceMemberDetails },
  } = useMember();
  const { data: currentUser } = useUser();
  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();
  // form info
  const {
    control,
    formState: { errors },
  } = useForm();
  // derived values
  const roleLabel = ROLE[rowData.original_role ?? EUserPermissions.GUEST];
  const isCurrentUser = currentUser?.id === rowData.member.id;
  const isRowDataWorkspaceAdmin = [EUserPermissions.ADMIN].includes(
    Number(getWorkspaceMemberDetails(rowData.member.id)?.role) ?? EUserPermissions.GUEST
  );
  const isCurrentUserWorkspaceAdmin = currentUser
    ? [EUserPermissions.ADMIN].includes(
        Number(getWorkspaceMemberDetails(currentUser.id)?.role) ?? EUserPermissions.GUEST
      )
    : false;
  const currentProjectRole = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId);

  const isCurrentUserProjectAdmin = currentProjectRole
    ? ![EUserPermissions.MEMBER, EUserPermissions.GUEST].includes(Number(currentProjectRole) ?? EUserPermissions.GUEST)
    : false;

  // logic
  // Workspace admin can change his own role
  // Project admin can change any role except his own and workspace admin's role
  const isRoleEditable =
    (isCurrentUserWorkspaceAdmin && isCurrentUser) ||
    (isCurrentUserProjectAdmin && !isRowDataWorkspaceAdmin && !isCurrentUser);
  const checkCurrentOptionWorkspaceRole = (value: string) => {
    const currentMemberWorkspaceRole = getWorkspaceMemberDetails(value)?.role as EUserPermissions | undefined;
    if (!value || !currentMemberWorkspaceRole) return ROLE;

    const isGuest = [EUserPermissions.GUEST].includes(currentMemberWorkspaceRole);

    return Object.fromEntries(
      Object.entries(ROLE).filter(([key]) => !isGuest || parseInt(key) === EUserPermissions.GUEST)
    );
  };

  return (
    <>
      {isRoleEditable ? (
        <Controller
          name="role"
          control={control}
          rules={{ required: "Role is required." }}
          render={() => (
            <CustomSelect
              value={rowData.original_role}
              onChange={async (value: EUserProjectRoles) => {
                if (!workspaceSlug) return;
                await updateMemberRole(workspaceSlug.toString(), projectId.toString(), rowData.member.id, value).catch(
                  (err) => {
                    console.log(err, "err");
                    const error = err.error;
                    const errorString = Array.isArray(error) ? error[0] : error;

                    setToast({
                      type: TOAST_TYPE.ERROR,
                      title: "You can’t change this role yet.",
                      message: errorString ?? "An error occurred while updating member role. Please try again.",
                    });
                  }
                );
              }}
              label={
                <div className="flex">
                  <span>{roleLabel}</span>
                </div>
              }
              buttonClassName={`!px-0 !justify-start hover:bg-surface-1 ${errors.role ? "border-danger-strong" : "border-none"}`}
              className="w-32 rounded-md p-0"
              input
            >
              {Object.entries(checkCurrentOptionWorkspaceRole(rowData.member.id)).map(([key, label]) => (
                <CustomSelect.Option key={key} value={key}>
                  {label}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          )}
        />
      ) : (
        <div className="flex w-32">
          <span>{roleLabel}</span>
        </div>
      )}
    </>
  );
});

type ProfilesColumnProps = {
  rowData: RowData;
  workspaceSlug: string;
  projectId: string;
};

/**
 * Owner/ws-or-project-admin/BD-lead control to manage a BD member's Profile assignments
 * FOR THIS PROJECT. Only meaningful for team="bd" members; the server enforces the gate,
 * project scope, and validation.
 */
export const ProfilesColumn = observer(function ProfilesColumn({
  rowData,
  workspaceSlug,
  projectId,
}: ProfilesColumnProps) {
  const {
    workspace: { getWorkspaceMemberDetails },
  } = useMember();
  const memberDetails = getWorkspaceMemberDetails(rowData.member.id);
  const memberPk = memberDetails?.id;
  // A BD team lead is an overseer — they see every lead regardless of profile, so profile
  // scoping does not apply to them (mirrors bd_visibility._is_overseer on the backend).
  const isTeamLead = !!memberDetails?.is_team_lead;
  const [team, setTeam] = useState<string | null>(null);
  const [available, setAvailable] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workspaceSlug || !projectId || !memberPk) return;
    let active = true;
    void (async () => {
      try {
        const d = await workspaceService.getProjectMemberProfiles(workspaceSlug, projectId, memberPk);
        if (!active) return;
        setTeam(d.team);
        setAvailable(d.available ?? []);
        setSelected(d.profile_option_ids ?? []);
      } catch {
        /* ignore load errors */
      }
    })();
    return () => {
      active = false;
    };
  }, [workspaceSlug, projectId, memberPk]);

  if (team !== "bd") return <span className="text-xs text-placeholder">—</span>;

  // Promoted to BD lead: profile assignments are irrelevant (a lead sees all leads). Show that
  // plainly instead of a misleading scoped count, and don't offer the editable selector. Any
  // prior assignments are kept (harmless — ignored while they're a lead) so a later demotion
  // back to a regular BD restores them.
  if (isTeamLead)
    return (
      <span className="text-xs text-placeholder" title="Team leads see all leads, regardless of profile">
        All leads
      </span>
    );

  const save = async (next: string[]) => {
    if (!memberPk) return;
    const prev = selected;
    setSelected(next);
    setBusy(true);
    try {
      await workspaceService.updateProjectMemberProfiles(workspaceSlug, projectId, memberPk, next);
    } catch (err: unknown) {
      setSelected(prev);
      const error = err as { error?: string };
      setToast({ type: TOAST_TYPE.ERROR, title: "Error!", message: error?.error ?? "Could not update profiles." });
    } finally {
      setBusy(false);
    }
  };

  const options = available.map((o) => ({ value: o.id, query: o.name, content: <span>{o.name}</span> }));
  const label = (
    <span className={selected.length ? "" : "text-placeholder"}>
      {selected.length ? `${selected.length} profile${selected.length > 1 ? "s" : ""}` : "None"}
    </span>
  );

  return (
    <CustomSearchSelect
      multiple
      options={options}
      value={selected}
      onChange={(vals: string[]) => save(vals)}
      label={label}
      disabled={busy || !memberPk}
      className="w-40"
      buttonClassName="border-none bg-transparent px-2 h-7.5 text-body-xs-regular hover:bg-layer-1"
      optionsClassName="w-56"
    />
  );
});
