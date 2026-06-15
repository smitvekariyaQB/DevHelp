from django.conf import settings


def get_site_base_url(request=None):
    """Return the public site base URL (no trailing slash).

    Prefer SITE_URL from settings/.env. Fall back to the current request origin
    when SITE_URL is unset so email links match how the app is being accessed.
    """
    base = (getattr(settings, 'SITE_URL', '') or '').strip().rstrip('/')
    if base:
        return base
    if request is not None:
        return request.build_absolute_uri('/').rstrip('/')
    return 'http://127.0.0.1:8000'


def build_site_url(path, request=None):
    """Build an absolute URL for emails and external links."""
    if not path.startswith('/'):
        path = f'/{path}'
    return f'{get_site_base_url(request)}{path}'
