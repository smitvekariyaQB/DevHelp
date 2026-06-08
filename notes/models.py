from django.conf import settings
from django.db import models
from django.utils.html import strip_tags

from core.models import SoftDeleteModel


class Note(SoftDeleteModel):
    COLORS = [
        ('#FFFFFF', 'White'),
        ('#FFF9C4', 'Yellow'),
        ('#FFE0B2', 'Orange'),
        ('#F8BBD0', 'Pink'),
        ('#E1BEE7', 'Purple'),
        ('#BBDEFB', 'Blue'),
        ('#C8E6C9', 'Green'),
        ('#F5F5F5', 'Gray'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notes',
    )
    workspace = models.ForeignKey(
        'workspaces.Workspace',
        on_delete=models.CASCADE,
        related_name='notes',
    )
    title = models.CharField(max_length=200, default='Untitled')
    content = models.TextField(blank=True)
    color = models.CharField(max_length=7, default='#FFFFFF')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.title

    @property
    def preview(self):
        text = strip_tags(self.content).strip() or 'No content'
        return text[:120] + ('…' if len(text) > 120 else '')
