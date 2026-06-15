from .permissions import can_edit_content, get_accessible_workspaces


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
        }
    return {'workspaces': [], 'can_edit_content': False}
