from datetime import timedelta

from django.utils import timezone

from django.db.models import Q

from .models import WorkspaceActivity

UPDATE_THROTTLE_SECONDS = 45


def workspace_has_collaborators(workspace):
    return workspace.members.exclude(status='revoked').exists()


def user_display_name(user):
    full_name = user.get_full_name().strip()
    if full_name:
        return f'{full_name} ({user.email})'
    return user.email


def log_activity(workspace, user, tool, action, object_label, details, object_id=None):
    if not workspace_has_collaborators(workspace):
        return None

    object_label = (object_label or '')[:200]
    details = (details or '')[:2000]

    if action == 'update' and object_id is not None:
        cutoff = timezone.now() - timedelta(seconds=UPDATE_THROTTLE_SECONDS)
        recent = (
            WorkspaceActivity.objects.filter(
                workspace=workspace,
                user=user,
                tool=tool,
                object_id=object_id,
                action='update',
                created_at__gte=cutoff,
            )
            .order_by('-created_at')
            .first()
        )
        if recent:
            recent.object_label = object_label
            recent.details = details
            recent.save(update_fields=['object_label', 'details'])
            return recent

    return WorkspaceActivity.objects.create(
        workspace=workspace,
        user=user,
        tool=tool,
        action=action,
        object_id=object_id,
        object_label=object_label,
        details=details,
    )


def log_from_request(request, tool, action, object_label, details, object_id=None):
    workspace = getattr(request, 'workspace', None)
    if not workspace or not request.user.is_authenticated:
        return None
    return log_activity(
        workspace,
        request.user,
        tool,
        action,
        object_label,
        details,
        object_id=object_id,
    )


def log_create(request, tool, object_label, details, object_id):
    return log_from_request(request, tool, 'create', object_label, details, object_id)


def log_update(request, tool, object_label, details, object_id):
    return log_from_request(request, tool, 'update', object_label, details, object_id)


def log_delete(request, tool, object_label, details, object_id=None):
    return log_from_request(request, tool, 'delete', object_label, details, object_id)


def get_workspace_activity_queryset(workspace, tool=None, object_id=None):
    qs = WorkspaceActivity.objects.filter(workspace=workspace).select_related('user')
    if tool:
        qs = qs.filter(tool=tool)
    if object_id is not None:
        try:
            object_id = int(object_id)
        except (TypeError, ValueError):
            return qs.none()
        if tool == 'todos':
            from todos.models import TodoTask

            task_ids = TodoTask.all_objects.filter(
                todo_list_id=object_id,
                workspace=workspace,
            ).values_list('id', flat=True)
            qs = qs.filter(Q(object_id=object_id) | Q(object_id__in=task_ids))
        else:
            qs = qs.filter(object_id=object_id)
    return qs


def serialize_activity(activity):
    return {
        'id': activity.id,
        'display_name': user_display_name(activity.user),
        'created_at': activity.created_at.isoformat(),
        'details': activity.details,
        'action': activity.action,
        'tool': activity.tool,
        'object_label': activity.object_label,
    }
