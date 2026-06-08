from django.db.models.signals import post_save
from django.dispatch import receiver
from django.conf import settings

from .models import Workspace, DEFAULT_TOOLS, PERSONAL_WORKSPACE_NAME

@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_default_workspace(sender, instance, created, **kwargs):
    if created:
        Workspace.objects.create(
            user=instance,
            name=PERSONAL_WORKSPACE_NAME,
            is_default=True,
            enabled_tools=list(DEFAULT_TOOLS)
        )
