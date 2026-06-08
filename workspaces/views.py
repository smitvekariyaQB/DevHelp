from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST
from django.contrib import messages

from codefiles.models import CodeDocument
from jsondocs.models import JsonDocument
from markdown.models import MarkdownDocument
from notes.models import Note
from tables.models import TableSheet
from todos.models import TodoList, TodoTask

from .models import Workspace, TOOL_CHOICES

@login_required
def workspace_list(request):
    return render(request, 'workspaces/list.html', {
        'workspaces': request.user.workspaces.all(),
    })

@login_required
def workspace_edit(request, pk=None):
    if pk:
        workspace = get_object_or_404(Workspace, id=pk, user=request.user)
        is_edit = True
    else:
        workspace = None
        is_edit = False

    tool_choices = TOOL_CHOICES
    valid_tool_keys = [t[0] for t in tool_choices]

    if request.method == 'POST':
        name = request.POST.get('name', '').strip()
        tools = request.POST.getlist('tools')
        valid_tools = [t for t in tools if t in valid_tool_keys]

        if not name:
            messages.error(request, 'Workspace name is required.')
        else:
            if is_edit:
                workspace.name = name[:100]
                if not workspace.is_default:
                    workspace.enabled_tools = valid_tools
                workspace.save()
                messages.success(request, 'Workspace updated.')
            else:
                Workspace.objects.create(
                    user=request.user,
                    name=name[:100],
                    is_default=False,
                    enabled_tools=valid_tools
                )
                messages.success(request, 'Workspace created.')
            return redirect('workspaces:list')

    context = {
        'workspace': workspace,
        'is_edit': is_edit,
        'tool_choices': tool_choices,
    }
    return render(request, 'workspaces/edit.html', context)

@login_required
@require_POST
def api_delete(request):
    ws_id = request.POST.get('workspace_id')
    ws = get_object_or_404(Workspace, id=ws_id, user=request.user)
    if ws.is_default:
        messages.error(request, 'Cannot delete personal workspace.')
    else:
        Note.all_objects.filter(workspace=ws).update(is_deleted=True)
        TodoList.all_objects.filter(workspace=ws).update(is_deleted=True)
        TodoTask.all_objects.filter(workspace=ws).update(is_deleted=True)
        TableSheet.all_objects.filter(workspace=ws).update(is_deleted=True)
        JsonDocument.all_objects.filter(workspace=ws).update(is_deleted=True)
        MarkdownDocument.all_objects.filter(workspace=ws).update(is_deleted=True)
        CodeDocument.all_objects.filter(workspace=ws).update(is_deleted=True)
        ws.delete()
        messages.success(request, 'Workspace deleted.')
    return redirect('workspaces:list')
