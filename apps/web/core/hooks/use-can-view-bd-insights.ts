import { useParams } from "next/navigation";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser, useUserPermissions } from "@/hooks/store/user";

/**
 * Frontend mirror of the backend advance-analytics-bd gate: a workspace ADMIN who is either
 * the workspace OWNER or has been granted the additive per-member `can_view_analytics` flag.
 *
 * The backend still enforces this on the analytics endpoints (403 otherwise) — this hook only
 * controls UI visibility so non-authorized users don't see the entry point.
 */
export const useCanViewBDInsights = (): boolean => {
  const { workspaceSlug } = useParams();
  const { allowPermissions, workspaceInfoBySlug } = useUserPermissions();
  const { data: currentUser } = useUser();
  const { currentWorkspace } = useWorkspace();

  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const memberInfo = workspaceSlug ? workspaceInfoBySlug(workspaceSlug.toString()) : undefined;
  const ownerId = typeof currentWorkspace?.owner === "string" ? currentWorkspace?.owner : currentWorkspace?.owner?.id;
  const isWorkspaceOwner = !!currentUser?.id && ownerId === currentUser.id;

  return isWorkspaceOwner || (isWorkspaceAdmin && !!memberInfo?.can_view_analytics);
};
