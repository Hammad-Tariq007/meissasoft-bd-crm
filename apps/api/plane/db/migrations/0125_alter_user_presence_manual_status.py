# Generated for the 4-state presence manual override (online/away/dnd/offline).

from django.db import migrations, models


def available_to_online(apps, schema_editor):
    User = apps.get_model("db", "User")
    User.objects.filter(presence_manual_status="available").update(presence_manual_status="online")


def online_to_available(apps, schema_editor):
    User = apps.get_model("db", "User")
    # "away"/"offline" have no pre-4-state equivalent; collapse them back to available too.
    User.objects.exclude(presence_manual_status="dnd").update(presence_manual_status="available")


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0124_user_presence_manual_status"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="presence_manual_status",
            field=models.CharField(
                choices=[
                    ("online", "Online"),
                    ("away", "Away"),
                    ("dnd", "Do Not Disturb"),
                    ("offline", "Offline"),
                ],
                default="online",
                max_length=20,
            ),
        ),
        migrations.RunPython(available_to_online, online_to_available),
    ]
