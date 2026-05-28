import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_http_methods, require_POST

from .defaults import DEFAULT_MARKDOWN_CONTENT
from .models import MarkdownDocument


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
    documents = request.user.markdown_documents.all()
    selected_id = request.GET.get('doc')
    current_doc = None

    if not documents.exists():
        current_doc = MarkdownDocument.objects.create(
            user=request.user,
            title='Untitled.md',
            content=DEFAULT_MARKDOWN_CONTENT,
        )
        documents = request.user.markdown_documents.all()
    elif selected_id:
        current_doc = get_object_or_404(MarkdownDocument, pk=selected_id, user=request.user)
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
        'markdown/index.html',
        {
            'documents': doc_list,
            'current_doc': current_doc,
        },
    )


@login_required
@require_http_methods(['POST'])
def doc_create(request):
    data = _json_body(request)
    title = (data.get('title') or 'Untitled.md').strip()[:200] or 'Untitled.md'
    content = data.get('content', DEFAULT_MARKDOWN_CONTENT)
    if not isinstance(content, str):
        content = DEFAULT_MARKDOWN_CONTENT
    doc = MarkdownDocument.objects.create(
        user=request.user,
        title=title,
        content=content[:500000],
    )
    return JsonResponse({'document': _doc_payload(doc)})


@login_required
@require_POST
def doc_autosave(request, pk):
    doc = get_object_or_404(MarkdownDocument, pk=pk, user=request.user)
    data = _json_body(request)

    if 'title' in data:
        doc.title = (data.get('title') or 'Untitled.md').strip()[:200] or 'Untitled.md'
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
    doc = get_object_or_404(MarkdownDocument, pk=pk, user=request.user)
    doc.delete()
    return JsonResponse({'ok': True})
