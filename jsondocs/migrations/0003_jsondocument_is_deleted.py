from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('jsondocs', '0002_jsondocument_workspace_alter_jsondocument_content'),
    ]

    operations = [
        migrations.AddField(
            model_name='jsondocument',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
