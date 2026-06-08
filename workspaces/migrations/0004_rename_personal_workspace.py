from django.db import migrations


def rename_default_workspaces(apps, schema_editor):
    Workspace = apps.get_model('workspaces', 'Workspace')
    Workspace.objects.filter(is_default=True, name='Workspace').update(name='Personal Workspace')


def reverse_rename(apps, schema_editor):
    Workspace = apps.get_model('workspaces', 'Workspace')
    Workspace.objects.filter(is_default=True, name='Personal Workspace').update(name='Workspace')


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0003_workspace_is_deleted'),
    ]

    operations = [
        migrations.RunPython(rename_default_workspaces, reverse_rename),
    ]
