from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('todos', '0002_todolist_workspace_todotask_workspace'),
    ]

    operations = [
        migrations.AddField(
            model_name='todolist',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='todotask',
            name='is_deleted',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
