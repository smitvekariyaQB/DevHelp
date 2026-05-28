from django.conf import settings
from django.db import models


class MarkdownDocument(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='markdown_documents',
    )
    title = models.CharField(max_length=200, default='Untitled.md')
    content = models.TextField(default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.title

    @property
    def preview(self):
        text = (self.content or '').strip().replace('\n', ' ')
        if not text:
            return 'Empty markdown'
        return text[:80] + ('…' if len(text) > 80 else '')
