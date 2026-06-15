import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from workspaces.permissions import require_content_edit, viewer_forbidden_json

from .models import Note
from .utils import sanitize_note_html

ALLOWED_COLORS = {hex for hex, _ in Note.COLORS}


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
    notes = Note.objects.filter(workspace=request.workspace)
    return render(request, 'notes/index.html', {'notes': notes})


@login_required
def create(request):
    forbidden = require_content_edit(request)
    if forbidden:
        return forbidden
    if request.method == 'POST':
        note = Note.objects.create(user=request.user, workspace=request.workspace, title='Untitled')
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
            note.delete()
            messages.success(request, 'Note deleted.')
            return redirect('notes:index')

        _apply_note_fields(note, request.POST)
        messages.success(request, 'Note saved.')
        return redirect('notes:edit', pk=note.pk)

    return render(
        request,
        'notes/edit.html',
        {
            'note': note,
            'colors': Note.COLORS,
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
    return JsonResponse({'ok': True, 'color': note.color})
