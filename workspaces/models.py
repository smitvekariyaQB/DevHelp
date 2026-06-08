from django.conf import settings
from django.db import models

from core.models import SoftDeleteModel

DEFAULT_TOOLS = ['todos', 'notes', 'tables', 'jsondocs', 'markdown', 'codefiles']
TOOL_CHOICES = [
    ('todos', 'To Do'),
    ('notes', 'Notes'),
    ('tables', 'Tables'),
    ('jsondocs', 'JSON'),
    ('markdown', 'Markdown'),
    ('codefiles', 'Code'),
]
TOOL_LABELS = dict(TOOL_CHOICES)
PERSONAL_WORKSPACE_NAME = 'Personal Workspace'

def default_tools_list():
    return list(DEFAULT_TOOLS)

class Workspace(SoftDeleteModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='workspaces',
    )
    name = models.CharField(max_length=100)
    is_default = models.BooleanField(default=False)
    enabled_tools = models.JSONField(default=default_tools_list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'created_at']
        unique_together = [['user', 'name']]

    def __str__(self):
        return self.name

    def has_tool(self, tool_name):
        return tool_name in self.enabled_tools

    @property
    def enabled_tools_display(self):
        labels = [TOOL_LABELS[key] for key, _ in TOOL_CHOICES if key in self.enabled_tools]
        return ', '.join(labels)

    def delete(self, using=None, keep_parents=False):
        if not self.is_deleted:
            suffix = f'__deleted__{self.pk}'
            max_base = self._meta.get_field('name').max_length - len(suffix)
            self.name = f'{self.name[:max_base]}{suffix}'
        super().delete(using=using, keep_parents=keep_parents)
