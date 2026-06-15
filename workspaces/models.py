import uuid

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

MEMBER_ROLE_CHOICES = [
    ('editor', 'Editor'),
    ('viewer', 'Viewer'),
]

MEMBER_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('accepted', 'Accepted'),
    ('declined', 'Declined'),
    ('revoked', 'Revoked'),
]


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

    def get_role_for(self, user):
        if not user or not user.is_authenticated:
            return None
        if self.user_id == user.id:
            return 'owner'
        member = self.members.filter(
            user=user,
            status='accepted',
        ).first()
        if member:
            return member.role
        return None

    def user_can_access(self, user):
        return self.get_role_for(user) is not None

    def user_can_edit_content(self, user):
        role = self.get_role_for(user)
        return role in ('owner', 'editor')

    def user_can_manage(self, user):
        return self.get_role_for(user) == 'owner'

    def delete(self, using=None, keep_parents=False):
        if not self.is_deleted:
            suffix = f'__deleted__{self.pk}'
            max_base = self._meta.get_field('name').max_length - len(suffix)
            self.name = f'{self.name[:max_base]}{suffix}'
        super().delete(using=using, keep_parents=keep_parents)


class WorkspaceMember(SoftDeleteModel):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name='members',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='workspace_memberships',
        null=True,
        blank=True,
    )
    email = models.EmailField()
    role = models.CharField(max_length=10, choices=MEMBER_ROLE_CHOICES)
    status = models.CharField(max_length=10, choices=MEMBER_STATUS_CHOICES, default='pending')
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='workspace_invites_sent',
    )
    invited_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-invited_at']
        unique_together = [['workspace', 'email']]

    def __str__(self):
        return f'{self.email} ({self.role}) on {self.workspace}'


ACTIVITY_ACTION_CHOICES = [
    ('create', 'Created'),
    ('update', 'Updated'),
    ('delete', 'Deleted'),
]


class WorkspaceActivity(models.Model):
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name='activities',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='workspace_activities',
    )
    tool = models.CharField(max_length=20)
    action = models.CharField(max_length=10, choices=ACTIVITY_ACTION_CHOICES)
    object_id = models.PositiveIntegerField(null=True, blank=True)
    object_label = models.CharField(max_length=200, blank=True)
    details = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workspace', '-created_at']),
            models.Index(fields=['workspace', 'tool', '-created_at']),
        ]

    def __str__(self):
        return f'{self.user_id} {self.action} {self.tool} in {self.workspace_id}'
