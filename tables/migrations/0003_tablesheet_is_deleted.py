from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tables', '0002_tablesheet_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='tablesheet',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
