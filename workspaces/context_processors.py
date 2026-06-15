from .activity import workspace_has_collaborators
from .permissions import can_edit_content, get_accessible_workspaces


def show_workspace_history(request):
    workspace = getattr(request, 'workspace', None)
    if not workspace or not request.user.is_authenticated:
        return False
    if not workspace_has_collaborators(workspace):
        return False
    return workspace.get_role_for(request.user) is not None


def workspaces_context(request):
    if request.user.is_authenticated:
        workspaces = []
        for ws in get_accessible_workspaces(request.user):
            role = ws.get_role_for(request.user)
            ws.access_role = role
            ws.is_shared = role in ('editor', 'viewer')
            workspaces.append(ws)
        return {
            'workspaces': workspaces,
            'can_edit_content': can_edit_content(request),
            'show_workspace_history': show_workspace_history(request),
        }
    return {
        'workspaces': [],
        'can_edit_content': False,
        'show_workspace_history': False,
    }
