from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .services import ensure_default_lists


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_default_todo_lists(sender, instance, created, **kwargs):
    if created:
        ensure_default_lists(instance)
