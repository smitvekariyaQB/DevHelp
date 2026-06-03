from codefiles.defaults import EXTENSION_LANGUAGES, extension_from_title

# Extra extensions for compare / local files (hljs or plaintext).
COMPARE_EXTENSION_LANGUAGES = {
    **EXTENSION_LANGUAGES,
    'env': 'ini',
    'ini': 'ini',
    'cfg': 'ini',
    'conf': 'ini',
    'properties': 'ini',
    'txt': 'plaintext',
    'log': 'plaintext',
    'ajax': 'javascript',
}


def language_for_filename(title):
    ext = extension_from_title(title)
    if not ext and title.lower().endswith('.env'):
        return COMPARE_EXTENSION_LANGUAGES.get('env', 'ini')
    return COMPARE_EXTENSION_LANGUAGES.get(ext, 'plaintext')
