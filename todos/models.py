from django.conf import settings
from django.db import models


class TodoList(models.Model):
    SMART_MY_DAY = 'my_day'
    SMART_IMPORTANT = 'important'
    SMART_CHOICES = [
        (SMART_MY_DAY, 'My Day'),
        (SMART_IMPORTANT, 'Important'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='todo_lists',
    )
    title = models.CharField(max_length=120)
    color = models.CharField(max_length=7, default='#007AFF')
    smart_type = models.CharField(max_length=20, blank=True, choices=SMART_CHOICES)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'created_at']

    @property
    def is_smart(self):
        return bool(self.smart_type)

    def __str__(self):
        return self.title


class TodoTask(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='todo_tasks',
    )
    todo_list = models.ForeignKey(
        TodoList,
        on_delete=models.CASCADE,
        related_name='tasks',
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=255)
    notes = models.TextField(blank=True)
    due_date = models.DateField(null=True, blank=True)
    is_completed = models.BooleanField(default=False)
    is_important = models.BooleanField(default=False)
    in_my_day = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['is_completed', 'order', '-created_at']

    def __str__(self):
        return self.title
