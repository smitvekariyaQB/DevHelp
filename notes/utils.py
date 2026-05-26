import bleach

ALLOWED_TAGS = [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a',
]
ALLOWED_ATTRIBUTES = {'a': ['href', 'title', 'target', 'rel']}


def sanitize_note_html(content):
    if not content:
        return ''
    return bleach.clean(
        content,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True,
    )
