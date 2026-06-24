import copy
import json
import uuid

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from workspaces.activity import log_create, log_delete, log_update
from workspaces.permissions import require_content_edit, viewer_forbidden_json

from .models import TableSheet, default_sheet_data

ALLOWED_COLORS = {hex for hex, _ in TableSheet.COLORS}


def workspace_sheets(workspace):
    return TableSheet.objects.filter(workspace=workspace).order_by('-is_pinned', 'created_at')


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


def _as_data(value):
    if not isinstance(value, dict):
        return {'columns': [], 'rows': []}
    columns = value.get('columns')
    rows = value.get('rows')
    return {
        'columns': columns if isinstance(columns, list) else [],
        'rows': rows if isinstance(rows, list) else [],
    }


def _index_by_id(items):
    indexed = {}
    for item in items:
        if isinstance(item, dict) and item.get('id') is not None:
            indexed[str(item['id'])] = item
    return indexed


def _cells_of(row):
    if isinstance(row, dict) and isinstance(row.get('cells'), dict):
        return row['cells']
    return {}


def _merge_data(base, current, server):
    """Three-way merge so concurrent edits to different fields don't clobber.

    ``base`` is the state the client last synced from (common ancestor),
    ``current`` is the client's latest state, and ``server`` is what's stored
    in the DB right now (possibly changed by another browser). For each field
    we keep the client's value only where the client actually changed it
    (current != base); otherwise we keep the server's value.
    """
    base = _as_data(base)
    current = _as_data(current)
    server = _as_data(server)

    base_cols = _index_by_id(base['columns'])
    cur_cols = _index_by_id(current['columns'])
    srv_cols = _index_by_id(server['columns'])

    added_cols = set(cur_cols) - set(base_cols)
    deleted_cols = set(base_cols) - set(cur_cols)
    result_col_ids = (set(srv_cols) | added_cols) - deleted_cols

    ordered_col_ids = []
    for source in (current['columns'], server['columns']):
        for col in source:
            cid = str(col.get('id'))
            if cid in result_col_ids and cid not in ordered_col_ids:
                ordered_col_ids.append(cid)

    def merged_attr(cid, attr, default):
        base_col = base_cols.get(cid)
        cur_col = cur_cols.get(cid)
        srv_col = srv_cols.get(cid)
        if cur_col is not None and (base_col is None or cur_col.get(attr) != base_col.get(attr)):
            return cur_col.get(attr, default)
        if srv_col is not None:
            return srv_col.get(attr, default)
        if cur_col is not None:
            return cur_col.get(attr, default)
        return default

    result_columns = [
        {
            'id': cid,
            'label': merged_attr(cid, 'label', ''),
            'width': merged_attr(cid, 'width', 160),
        }
        for cid in ordered_col_ids
    ]

    base_rows = _index_by_id(base['rows'])
    cur_rows = _index_by_id(current['rows'])
    srv_rows = _index_by_id(server['rows'])

    added_rows = set(cur_rows) - set(base_rows)
    deleted_rows = set(base_rows) - set(cur_rows)
    result_row_ids = (set(srv_rows) | added_rows) - deleted_rows

    ordered_row_ids = []
    for source in (current['rows'], server['rows']):
        for row in source:
            rid = str(row.get('id'))
            if rid in result_row_ids and rid not in ordered_row_ids:
                ordered_row_ids.append(rid)

    result_rows = []
    for rid in ordered_row_ids:
        base_cells = _cells_of(base_rows.get(rid))
        cur_cells = _cells_of(cur_rows.get(rid))
        srv_cells = _cells_of(srv_rows.get(rid))
        client_knows_row = rid in cur_rows
        cells = {}
        for cid in ordered_col_ids:
            if client_knows_row and cid in cur_cells:
                client_changed = cid not in base_cells or cur_cells.get(cid) != base_cells.get(cid)
                if client_changed:
                    cells[cid] = cur_cells.get(cid)
                elif cid in srv_cells:
                    cells[cid] = srv_cells.get(cid)
                else:
                    cells[cid] = cur_cells.get(cid)
            elif cid in srv_cells:
                cells[cid] = srv_cells.get(cid)
            else:
                cells[cid] = ''
        result_rows.append({'id': rid, 'cells': cells})

    return {'columns': result_columns, 'rows': result_rows}


@login_required
def index(request):
    base = TableSheet.objects.filter(workspace=request.workspace)
    pinned_sheets = base.filter(is_pinned=True).order_by('-created_at')
    unpinned_sheets = base.filter(is_pinned=False).order_by('-created_at')
    return render(request, 'tables/index.html', {
        'pinned_sheets': pinned_sheets,
        'unpinned_sheets': unpinned_sheets,
        'sheets': base,
    })


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
            'workspace_sheets': workspace_sheets(request.workspace),
        },
    )


@login_required
def sheet_data(request, pk):
    sheet = get_object_or_404(TableSheet, pk=pk, workspace=request.workspace)
    return JsonResponse({
        'ok': True,
        'title': sheet.title,
        'color': sheet.color,
        'data': sheet.data,
        'updated_at': sheet.updated_at.isoformat(),
    })


@login_required
@require_POST
def autosave(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    data = _parse_body(request)

    with transaction.atomic():
        sheet = get_object_or_404(
            TableSheet.objects.select_for_update(),
            pk=pk,
            workspace=request.workspace,
        )

        sheet.title = (data.get('title') or sheet.title).strip()[:200] or 'Untitled table'
        if 'data' in data:
            incoming = data['data']
            base = data.get('base')
            if base is not None:
                incoming = _merge_data(base, incoming, sheet.data)
            sheet.data = _validate_data(incoming)
        color = data.get('color')
        if color and color in ALLOWED_COLORS:
            sheet.color = color
        sheet.save()

    log_update(request, 'tables', sheet.title, f'Updated table "{sheet.title}"', sheet.pk)
    return JsonResponse({
        'ok': True,
        'title': sheet.title,
        'color': sheet.color,
        'data': sheet.data,
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
