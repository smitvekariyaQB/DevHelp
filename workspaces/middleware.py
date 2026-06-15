from .permissions import attach_workspace_context, get_accessible_workspaces, resolve_workspace


class WorkspaceMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.workspace = None
        request.workspace_role = None

        if request.user.is_authenticated:
            w_id = request.GET.get('w')
            if w_id:
                try:
                    workspace, role = resolve_workspace(request.user, w_id)
                    attach_workspace_context(request, workspace, role)
                    request.session['active_workspace_id'] = workspace.id
                except Exception:
                    pass

            if not request.workspace:
                w_id = request.session.get('active_workspace_id')
                if w_id:
                    try:
                        workspace, role = resolve_workspace(request.user, w_id)
                        attach_workspace_context(request, workspace, role)
                    except Exception:
                        pass

            if not request.workspace:
                default_ws = request.user.workspaces.filter(is_default=True).first()
                if default_ws:
                    attach_workspace_context(request, default_ws, 'owner')
                    request.session['active_workspace_id'] = default_ws.id

        return self.get_response(request)
