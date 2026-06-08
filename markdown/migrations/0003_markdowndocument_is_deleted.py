from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('markdown', '0002_markdowndocument_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='markdowndocument',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
