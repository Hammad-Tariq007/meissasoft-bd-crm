# BD CRM team layer (Phase 2): profile assignments.
#
# A sidecar model — its OWN table, referencing Plane models by FK — so nothing is added
# to any Plane core table and upstream merges stay clean. Assignments are id-based
# (profile_option → CustomFieldOption.id, a stable UUID), so renaming a profile option's
# label never affects existing assignments.

from django.db import models

from .base import BaseModel


class ProfileAssignment(BaseModel):
    """Maps a BD (WorkspaceMember, team="bd") to a Profile option they may use on leads.

    One-to-many: a BD can hold multiple rows (one per assigned profile option). The
    profile is referenced by its CustomFieldOption id, not its name.
    """

    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="profile_assignments"
    )
    bd_member = models.ForeignKey(
        "db.WorkspaceMember", on_delete=models.CASCADE, related_name="profile_assignments"
    )
    profile_option = models.ForeignKey(
        "db.CustomFieldOption", on_delete=models.CASCADE, related_name="bd_assignments"
    )

    class Meta:
        verbose_name = "Profile Assignment"
        verbose_name_plural = "Profile Assignments"
        db_table = "bd_profile_assignments"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["bd_member", "profile_option"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_bd_member_profile_option_when_not_deleted",
            )
        ]

    def __str__(self):
        return f"{self.bd_member_id} -> {self.profile_option_id}"
