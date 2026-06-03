import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from codefiles.models import CodeDocument
from codefiles.defaults import extension_from_title
from jsondocs.models import JsonDocument
from markdown.models import MarkdownDocument

from .utils import COMPARE_EXTENSION_LANGUAGES, language_for_filename

SOURCE_LABELS = {
    'code': 'Code',
    'json': 'JSON',
    'markdown': 'Markdown',
}


def _file_entry(source, doc_id, title, updated_at):
    ext = extension_from_title(title)
    if not ext and title.lower().endswith('.env'):
        ext = 'env'
    return {
        'key': f'{source}:{doc_id}',
        'source': source,
        'id': doc_id,
        'title': title,
        'label': f'[{SOURCE_LABELS.get(source, source)}] {title}',
        'extension': ext,
        'language': language_for_filename(title),
        'updated_at': updated_at.isoformat(),
    }


@login_required
def index(request):
    return render(
        request,
        'compare/index.html',
        {
            'extension_languages_json': json.dumps(COMPARE_EXTENSION_LANGUAGES),
        },
    )


@login_required
@require_GET
def api_files(request):
    files = []

    for doc in request.user.code_documents.all():
        files.append(_file_entry('code', doc.pk, doc.title, doc.updated_at))
    for doc in request.user.json_documents.all():
        files.append(_file_entry('json', doc.pk, doc.title, doc.updated_at))
    for doc in request.user.markdown_documents.all():
        files.append(_file_entry('markdown', doc.pk, doc.title, doc.updated_at))

    files.sort(key=lambda f: f['title'].lower())
    return JsonResponse({'files': files})


@login_required
@require_GET
def api_file(request):
    source = (request.GET.get('source') or '').strip().lower()
    raw_id = request.GET.get('id')

    try:
        doc_id = int(raw_id)
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid file id.'}, status=400)

    if source == 'code':
        doc = CodeDocument.objects.filter(pk=doc_id, user=request.user).first()
    elif source == 'json':
        doc = JsonDocument.objects.filter(pk=doc_id, user=request.user).first()
    elif source == 'markdown':
        doc = MarkdownDocument.objects.filter(pk=doc_id, user=request.user).first()
    else:
        return JsonResponse({'error': 'Unknown source.'}, status=400)

    if not doc:
        return JsonResponse({'error': 'File not found.'}, status=404)

    return JsonResponse({
        'source': source,
        'id': doc_id,
        'title': doc.title,
        'content': doc.content or '',
        'language': language_for_filename(doc.title),
    })
