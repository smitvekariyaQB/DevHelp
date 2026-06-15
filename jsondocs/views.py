import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_http_methods, require_POST

from workspaces.permissions import can_edit_content, viewer_forbidden_json

from .models import JsonDocument


def _json_body(request):
    if request.body:
        return json.loads(request.body)
    return {}


def _doc_payload(doc):
    return {
        'id': doc.id,
        'title': doc.title,
        'content': doc.content,
        'preview': doc.preview,
        'updated_at': doc.updated_at.isoformat(),
    }


@login_required
def index(request):
    documents = JsonDocument.objects.filter(workspace=request.workspace)
    selected_id = request.GET.get('doc')
    current_doc = None

    if not documents.exists() and can_edit_content(request):
        current_doc = JsonDocument.objects.create(
            user=request.user,
            workspace=request.workspace,
            title='Untitled.json',
            content='',
        )
        documents = JsonDocument.objects.filter(workspace=request.workspace)
    elif selected_id:
        current_doc = get_object_or_404(JsonDocument, pk=selected_id, workspace=request.workspace)
    else:
        current_doc = documents.first()

    doc_list = [
        {
            **_doc_payload(doc),
            'selected': current_doc and doc.pk == current_doc.pk,
        }
        for doc in documents
    ]

    return render(
        request,
        'jsondocs/index.html',
        {
            'documents': doc_list,
            'current_doc': current_doc,
        },
    )


@login_required
@require_http_methods(['POST'])
def doc_create(request):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    data = _json_body(request)
    title = (data.get('title') or 'Untitled.json').strip()[:200] or 'Untitled.json'
    content = data.get('content', '')
    if not isinstance(content, str):
        content = ''
    doc = JsonDocument.objects.create(
        user=request.user,
        workspace=request.workspace,
        title=title,
        content=content[:500000],
    )
    return JsonResponse({'document': _doc_payload(doc)})


@login_required
@require_POST
def doc_autosave(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    doc = get_object_or_404(JsonDocument, pk=pk, workspace=request.workspace)
    data = _json_body(request)

    if 'title' in data:
        doc.title = (data.get('title') or 'Untitled.json').strip()[:200] or 'Untitled.json'
    if 'content' in data:
        content = data.get('content', '')
        if isinstance(content, str):
            doc.content = content[:500000]

    doc.save()
    return JsonResponse({
        'ok': True,
        'document': _doc_payload(doc),
    })


@login_required
@require_http_methods(['POST'])
def doc_delete(request, pk):
    forbidden = viewer_forbidden_json(request)
    if forbidden:
        return forbidden
    doc = get_object_or_404(JsonDocument, pk=pk, workspace=request.workspace)
    doc.delete()
    return JsonResponse({'ok': True})
