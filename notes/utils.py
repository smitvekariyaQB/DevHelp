import bleach

ALLOWED_TAGS = [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
]
ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title', 'target', 'rel'],
    # Quill 2 stores list type on <li> (data-list="bullet" | "ordered").
    'li': ['data-list', 'class'],
    'table': ['class', 'border', 'cellpadding', 'cellspacing'],
    'th': ['colspan', 'rowspan', 'class'],
    'td': ['colspan', 'rowspan', 'class'],
}


def sanitize_note_html(content):
    if not content:
        return ''
    return bleach.clean(
        content,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True,
    )
