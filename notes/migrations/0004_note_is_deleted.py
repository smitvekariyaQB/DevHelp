from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('notes', '0003_note_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='note',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
