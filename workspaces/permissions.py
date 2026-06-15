from django.http import Http404, HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404

from .models import Workspace

ROLE_RANK = {
    'viewer': 1,
    'editor': 2,
    'owner': 3,
}


def get_accessible_workspaces(user):
    if not user or not user.is_authenticated:
        return Workspace.objects.none()

    owned = user.workspaces.all()
    shared_ids = user.workspace_memberships.filter(
        status='accepted',
    ).values_list('workspace_id', flat=True)
    shared = Workspace.objects.filter(id__in=shared_ids)
    return (owned | shared).distinct()


def resolve_workspace(user, workspace_id):
    workspace = get_object_or_404(Workspace, id=workspace_id)
    role = workspace.get_role_for(user)
    if role is None:
        raise Http404
    return workspace, role


def attach_workspace_context(request, workspace, role):
    request.workspace = workspace
    request.workspace_role = role


def require_content_edit(request):
    if getattr(request, 'workspace_role', None) == 'viewer':
        return HttpResponseForbidden('You have view-only access to this workspace.')
    return None


def viewer_forbidden_json(request):
    if getattr(request, 'workspace_role', None) == 'viewer':
        return JsonResponse({'error': 'View-only access to this workspace.'}, status=403)
    return None


def require_workspace_owner(request):
    if getattr(request, 'workspace_role', None) != 'owner':
        return HttpResponseForbidden('Only the workspace owner can perform this action.')
    return None


def require_workspace_owner_for(workspace, user):
    if workspace.user_id != user.id:
        return HttpResponseForbidden('Only the workspace owner can perform this action.')
    return None


def can_edit_content(request):
    role = getattr(request, 'workspace_role', None)
    return role in ('owner', 'editor')
