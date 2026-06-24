import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
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
@require_POST
def autosave(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    note = get_object_or_404(Note, pk=pk, workspace=request.workspace)
    data = _parse_request_data(request)
    _apply_note_fields(note, data)
    log_update(request, 'notes', note.title, f'Updated note "{note.title}"', note.pk)
    return JsonResponse({
        'ok': True,
        'title': note.title,
        'color': note.color,
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
