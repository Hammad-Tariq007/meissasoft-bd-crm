# Generated for the BD CRM team layer (Phase 1): additive team + team-lead
# attributes on WorkspaceMember. No data migration — existing rows get team=NULL,
# is_team_lead=False.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0128_webpushsubscription_device_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspacemember",
            name="team",
            field=models.CharField(
                blank=True, choices=[("bd", "BD"), ("dev", "Dev")], max_length=10, null=True
            ),
        ),
        migrations.AddField(
            model_name="workspacemember",
            name="is_team_lead",
            field=models.BooleanField(default=False),
        ),
    ]
