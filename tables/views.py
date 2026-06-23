import copy
import json
import uuid

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from workspaces.activity import log_create, log_delete, log_update
from workspaces.permissions import require_content_edit, viewer_forbidden_json

from .models import TableSheet, default_sheet_data

ALLOWED_COLORS = {hex for hex, _ in TableSheet.COLORS}


def _parse_body(request):
    try:
        return json.loads(request.body)
    except json.JSONDecodeError:
        return request.POST


def _validate_data(data):
    if not isinstance(data, dict):
        return default_sheet_data()
    columns = data.get('columns', [])
    rows = data.get('rows', [])
    if not isinstance(columns, list) or not isinstance(rows, list):
        return default_sheet_data()
    clean_cols = []
    for col in columns:
        if isinstance(col, dict) and col.get('id'):
            clean_cols.append({
                'id': str(col['id']),
                'width': max(80, min(int(col.get('width', 160)), 600)),
                'label': str(col.get('label', ''))[:80],
            })
    if not clean_cols:
        return default_sheet_data()
    clean_rows = []
    col_ids = {c['id'] for c in clean_cols}
    for row in rows:
        if not isinstance(row, dict) or not row.get('id'):
            continue
        cells = row.get('cells', {})
        if not isinstance(cells, dict):
            cells = {}
        clean_cells = {
            cid: str(cells.get(cid, ''))[:5000]
            for cid in col_ids
        }
        clean_rows.append({'id': str(row['id']), 'cells': clean_cells})
    if not clean_rows:
        clean_rows = [
            {'id': str(uuid.uuid4()), 'cells': {c['id']: '' for c in clean_cols}}
        ]
    return {'columns': clean_cols, 'rows': clean_rows}


@login_required
def index(request):
    sheets = TableSheet.objects.filter(workspace=request.workspace).order_by('-is_pinned', '-created_at')
    return render(request, 'tables/index.html', {'sheets': sheets})


@login_required
def duplicate_sheet(request, pk):
    forbidden = require_content_edit(request)
    if forbidden:
        return forbidden
    sheet = get_object_or_404(TableSheet, pk=pk, workspace=request.workspace)
    new_sheet = TableSheet.objects.create(
        user=request.user,
        workspace=request.workspace,
        title=f'Copy of {sheet.title}'[:200],
        color=sheet.color,
        data=copy.deepcopy(sheet.data),
    )
    log_create(request, 'tables', new_sheet.title, f'Duplicated table as "{new_sheet.title}"', new_sheet.pk)
    messages.success(request, 'Table duplicated.')
    return redirect('tables:edit', pk=new_sheet.pk)


@login_required
def create(request):
    forbidden = require_content_edit(request)
    if forbidden:
        return forbidden
    if request.method == 'POST':
        sheet = TableSheet.objects.create(user=request.user, workspace=request.workspace, title='Untitled table')
        log_create(request, 'tables', sheet.title, f'Created table "{sheet.title}"', sheet.pk)
        return redirect('tables:edit', pk=sheet.pk)
    return redirect('tables:index')


@login_required
def edit(request, pk):
    sheet = get_object_or_404(TableSheet, pk=pk, workspace=request.workspace)

    if request.method == 'POST':
        forbidden = require_content_edit(request)
        if forbidden:
            return forbidden
        if request.POST.get('action') == 'delete':
            title = sheet.title
            sheet.delete()
            log_delete(request, 'tables', title, f'Deleted table "{title}"', pk)
            messages.success(request, 'Table deleted.')
            return redirect('tables:index')

        sheet.title = request.POST.get('title', 'Untitled table').strip()[:200] or 'Untitled table'
        color = request.POST.get('color', sheet.color)
        if color in ALLOWED_COLORS:
            sheet.color = color
        sheet.save()
        log_update(request, 'tables', sheet.title, f'Updated table "{sheet.title}"', sheet.pk)
        messages.success(request, 'Table saved.')
        return redirect('tables:edit', pk=sheet.pk)

    return render(
        request,
        'tables/edit.html',
        {
            'sheet': sheet,
            'sheet_data_json': json.dumps(sheet.data),
        },
    )


@login_required
@require_POST
def autosave(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    sheet = get_object_or_404(TableSheet, pk=pk, workspace=request.workspace)
    data = _parse_body(request)

    sheet.title = (data.get('title') or sheet.title).strip()[:200] or 'Untitled table'
    if 'data' in data:
        sheet.data = _validate_data(data['data'])
    color = data.get('color')
    if color and color in ALLOWED_COLORS:
        sheet.color = color
    sheet.save()

    log_update(request, 'tables', sheet.title, f'Updated table "{sheet.title}"', sheet.pk)
    return JsonResponse({
        'ok': True,
        'title': sheet.title,
        'updated_at': sheet.updated_at.isoformat(),
    })


@login_required
@require_POST
def toggle_pin(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    sheet = get_object_or_404(TableSheet, pk=pk, workspace=request.workspace)
    sheet.is_pinned = not sheet.is_pinned
    sheet.save(update_fields=['is_pinned'])
    action = 'Pinned' if sheet.is_pinned else 'Unpinned'
    log_update(request, 'tables', sheet.title, f'{action} table "{sheet.title}"', sheet.pk)
    return JsonResponse({'ok': True, 'is_pinned': sheet.is_pinned})


@login_required
@require_POST
def delete_item(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    sheet = get_object_or_404(TableSheet, pk=pk, workspace=request.workspace)
    title = sheet.title
    sheet.delete()
    log_delete(request, 'tables', title, f'Deleted table "{title}"', pk)
    return JsonResponse({'ok': True})
