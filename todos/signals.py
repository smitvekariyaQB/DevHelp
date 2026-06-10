from django.db.models.signals import post_save
from django.dispatch import receiver

from workspaces.models import Workspace

from .services import ensure_default_lists


@receiver(post_save, sender=Workspace)
def create_default_todo_lists(sender, instance, created, **kwargs):
    if created and instance.is_default:
        ensure_default_lists(instance.user, instance)
