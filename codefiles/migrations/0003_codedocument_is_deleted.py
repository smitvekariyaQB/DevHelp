from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('codefiles', '0002_codedocument_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='codedocument',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
