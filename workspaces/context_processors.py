from .models import Workspace

def workspaces_context(request):
    if request.user.is_authenticated:
        return {'workspaces': request.user.workspaces.all()}
    return {'workspaces': []}
