class WorkspaceMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            w_id = request.GET.get('w')
            if w_id:
                try:
                    request.workspace = request.user.workspaces.get(id=w_id)
                    request.session['active_workspace_id'] = w_id
                except Exception:
                    pass
            
            if not hasattr(request, 'workspace') or not request.workspace:
                w_id = request.session.get('active_workspace_id')
                if w_id:
                    try:
                        request.workspace = request.user.workspaces.get(id=w_id)
                    except Exception:
                        request.workspace = request.user.workspaces.filter(is_default=True).first()
                else:
                    request.workspace = request.user.workspaces.filter(is_default=True).first()
                    if request.workspace:
                        request.session['active_workspace_id'] = request.workspace.id
        
        return self.get_response(request)
