from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0002_create_default_workspaces'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspace',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
