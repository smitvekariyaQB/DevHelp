import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from workspaces.activity import log_create, log_delete, log_update
from workspaces.permissions import require_content_edit, viewer_forbidden_json

from .models import Note
from .utils import sanitize_note_html

ALLOWED_COLORS = {hex for hex, _ in Note.COLORS}


def workspace_notes(workspace):
    return Note.objects.filter(workspace=workspace).order_by('-is_pinned', 'created_at')


def _parse_request_data(request):
    try:
        return json.loads(request.body)
    except json.JSONDecodeError:
        return request.POST


def _apply_note_fields(note, data):
    title = (data.get('title') or 'Untitled').strip()[:200] or 'Untitled'
    note.title = title
    note.content = sanitize_note_html(data.get('content', ''))
    color = data.get('color')
    if color and color in ALLOWED_COLORS:
        note.color = color
    note.save()


def _merge_note_fields(base, current, note):
    """Three-way merge so concurrent edits to different fields don't clobber."""
    base = base if isinstance(base, dict) else {}
    current = current if isinstance(current, dict) else {}

    def pick(field, server_value, default=''):
        base_val = base.get(field, default)
        cur_val = current.get(field, default)
        if cur_val != base_val:
            return cur_val
        return server_value

    title = (pick('title', note.title, 'Untitled') or 'Untitled').strip()[:200] or 'Untitled'
    content = sanitize_note_html(pick('content', note.content, ''))
    color = pick('color', note.color, note.color)
    if color not in ALLOWED_COLORS:
        color = note.color
    return title, content, color


@login_required
def index(request):
    base = Note.objects.filter(workspace=request.workspace)
    pinned_notes = base.filter(is_pinned=True).order_by('-created_at')
    unpinned_notes = base.filter(is_pinned=False).order_by('-created_at')
    return render(request, 'notes/index.html', {
        'pinned_notes': pinned_notes,
        'unpinned_notes': unpinned_notes,
        'notes': base,
    })


@login_required
def create(request):
    forbidden = require_content_edit(request)
    if forbidden:
        return forbidden
    if request.method == 'POST':
        note = Note.objects.create(user=request.user, workspace=request.workspace, title='Untitled')
        log_create(request, 'notes', note.title, f'Created note "{note.title}"', note.pk)
        return redirect('notes:edit', pk=note.pk)
    return redirect('notes:index')


@login_required
def edit(request, pk):
    note = get_object_or_404(Note, pk=pk, workspace=request.workspace)

    if request.method == 'POST':
        forbidden = require_content_edit(request)
        if forbidden:
            return forbidden
        action = request.POST.get('action')
        if action == 'delete':
            title = note.title
            note.delete()
            log_delete(request, 'notes', title, f'Deleted note "{title}"', pk)
            messages.success(request, 'Note deleted.')
            return redirect('notes:index')

        _apply_note_fields(note, request.POST)
        log_update(request, 'notes', note.title, f'Updated note "{note.title}"', note.pk)
        messages.success(request, 'Note saved.')
        return redirect('notes:edit', pk=note.pk)

    return render(
        request,
        'notes/edit.html',
        {
            'note': note,
            'colors': Note.COLORS,
            'workspace_notes': workspace_notes(request.workspace),
        },
    )


@login_required
def note_data(request, pk):
    note = get_object_or_404(Note, pk=pk, workspace=request.workspace)
    return JsonResponse({
        'ok': True,
        'title': note.title,
        'color': note.color,
        'content': note.content,
        'updated_at': note.updated_at.isoformat(),
    })


@login_required
@require_POST
def autosave(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    data = _parse_request_data(request)

    with transaction.atomic():
        note = get_object_or_404(
            Note.objects.select_for_update(),
            pk=pk,
            workspace=request.workspace,
        )
        base = data.get('base')
        if base is not None:
            title, content, color = _merge_note_fields(base, data, note)
            note.title = title
            note.content = content
            note.color = color
            note.save()
        else:
            _apply_note_fields(note, data)

    log_update(request, 'notes', note.title, f'Updated note "{note.title}"', note.pk)
    return JsonResponse({
        'ok': True,
        'title': note.title,
        'color': note.color,
        'content': note.content,
        'updated_at': note.updated_at.isoformat(),
    })


@login_required
@require_POST
def update_color(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    note = get_object_or_404(Note, pk=pk, workspace=request.workspace)
    data = _parse_request_data(request)
    color = data.get('color', '')
    if color not in ALLOWED_COLORS:
        return JsonResponse({'error': 'Invalid color'}, status=400)
    note.color = color
    note.save(update_fields=['color', 'updated_at'])
    log_update(request, 'notes', note.title, f'Changed color of note "{note.title}"', note.pk)
    return JsonResponse({'ok': True, 'color': note.color})


@login_required
@require_POST
def toggle_pin(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    note = get_object_or_404(Note, pk=pk, workspace=request.workspace)
    note.is_pinned = not note.is_pinned
    note.save(update_fields=['is_pinned'])
    action = 'Pinned' if note.is_pinned else 'Unpinned'
    log_update(request, 'notes', note.title, f'{action} note "{note.title}"', note.pk)
    return JsonResponse({'ok': True, 'is_pinned': note.is_pinned})


@login_required
@require_POST
def delete_item(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    note = get_object_or_404(Note, pk=pk, workspace=request.workspace)
    title = note.title
    note.delete()
    log_delete(request, 'notes', title, f'Deleted note "{title}"', pk)
    return JsonResponse({'ok': True})
