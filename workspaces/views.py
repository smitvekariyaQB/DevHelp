from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.http import urlencode
from django.views.decorators.http import require_POST

from codefiles.models import CodeDocument
from jsondocs.models import JsonDocument
from markdown.models import MarkdownDocument
from notes.models import Note
from tables.models import TableSheet
from todos.models import TodoList, TodoTask

from .models import MEMBER_ROLE_CHOICES, Workspace, WorkspaceMember, TOOL_CHOICES
from .permissions import require_workspace_owner_for, resolve_workspace
from .services import accept_workspace_invite, create_workspace_invite, normalize_email


def _get_shared_workspaces(user):
    shared_ids = user.workspace_memberships.filter(
        status='accepted',
    ).values_list('workspace_id', flat=True)
    workspaces = []
    for ws in Workspace.objects.filter(id__in=shared_ids).select_related('user'):
        ws.access_role = ws.get_role_for(user)
        workspaces.append(ws)
    return workspaces


@login_required
def workspace_list(request):
    return render(request, 'workspaces/list.html', {
        'owned_workspaces': request.user.workspaces.all(),
        'shared_workspaces': _get_shared_workspaces(request.user),
        'settings_active': 'workspaces',
    })


@login_required
def workspace_view(request, pk):
    workspace, role = resolve_workspace(request.user, pk)
    if role == 'owner':
        return redirect('workspaces:edit', pk=pk)

    members = workspace.members.exclude(status='revoked').select_related('user')
    return render(request, 'workspaces/view.html', {
        'workspace': workspace,
        'access_role': role,
        'members': members,
        'settings_active': 'workspaces',
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
                    enabled_tools=valid_tools,
                )
                messages.success(request, 'Workspace created.')
            return redirect('workspaces:list')

    members = []
    can_share = False
    if is_edit and workspace:
        members = workspace.members.exclude(status='revoked')
        can_share = workspace.user_can_manage(request.user) and not workspace.is_default

    context = {
        'workspace': workspace,
        'is_edit': is_edit,
        'tool_choices': tool_choices,
        'settings_active': 'workspaces',
        'members': members,
        'can_share': can_share,
        'member_role_choices': MEMBER_ROLE_CHOICES,
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
        WorkspaceMember.all_objects.filter(workspace=ws).update(is_deleted=True)
        ws.delete()
        messages.success(request, 'Workspace deleted.')
    return redirect('workspaces:list')


@login_required
@require_POST
def share_invite(request, pk):
    workspace = get_object_or_404(Workspace, id=pk, user=request.user)
    forbidden = require_workspace_owner_for(workspace, request.user)
    if forbidden:
        return forbidden

    if workspace.is_default:
        messages.error(request, 'Personal workspace cannot be shared.')
        return redirect('workspaces:edit', pk=pk)

    email = request.POST.get('email', '')
    role = request.POST.get('role', 'viewer')
    member, error = create_workspace_invite(workspace, email, role, request.user, request=request)
    if error:
        messages.error(request, error)
    else:
        messages.success(request, f'Invitation sent to {member.email}.')

    return redirect(f'{reverse("workspaces:edit", kwargs={"pk": pk})}#share')


@login_required
@require_POST
def share_manage(request, pk, member_id):
    workspace = get_object_or_404(Workspace, id=pk, user=request.user)
    forbidden = require_workspace_owner_for(workspace, request.user)
    if forbidden:
        return forbidden

    member = get_object_or_404(WorkspaceMember, id=member_id, workspace=workspace)
    action = request.POST.get('action')

    if action == 'revoke':
        member.status = 'revoked'
        member.save(update_fields=['status'])
        messages.success(request, f'Access revoked for {member.email}.')
    elif action == 'change_role':
        role = request.POST.get('role')
        if role in ('editor', 'viewer'):
            member.role = role
            member.save(update_fields=['role'])
            messages.success(request, f'Role updated for {member.email}.')
        else:
            messages.error(request, 'Invalid role selected.')

    return redirect(f'{reverse("workspaces:edit", kwargs={"pk": pk})}#share')


def accept_invite(request, token):
    member = get_object_or_404(WorkspaceMember, token=token, status='pending')

    if not request.user.is_authenticated:
        accept_path = reverse('workspaces:accept_invite', kwargs={'token': token})
        login_url = reverse('accounts:login')
        query = urlencode({'next': accept_path})
        return redirect(f'{login_url}?{query}')

    if normalize_email(request.user.email) != normalize_email(member.email):
        messages.error(request, 'This invitation was sent to a different email address.')
        return redirect('todos:index')

    ok, error = accept_workspace_invite(member, request.user)
    if not ok:
        messages.error(request, error)
        return redirect('todos:index')

    messages.success(request, f'You now have access to "{member.workspace.name}".')
    return redirect(f'{reverse("todos:index")}?w={member.workspace_id}')
