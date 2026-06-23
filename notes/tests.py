from django.test import TestCase

from .utils import sanitize_note_html


class SanitizeNoteHtmlTests(TestCase):
    def test_preserves_table_structure(self):
        html = (
            '<p>Intro</p>'
            '<table class="note-pasted-table"><thead><tr>'
            '<th>A</th><th>B</th></tr></thead><tbody><tr>'
            '<td>1</td><td>2</td></tr></tbody></table>'
        )
        cleaned = sanitize_note_html(html)
        self.assertIn('<table', cleaned)
        self.assertIn('<th>A</th>', cleaned)
        self.assertIn('<td>1</td>', cleaned)
        self.assertIn('<p>Intro</p>', cleaned)

    def test_strips_unsafe_table_attributes(self):
        html = '<table onclick="alert(1)"><tr><td style="color:red">x</td></tr></table>'
        cleaned = sanitize_note_html(html)
        self.assertNotIn('onclick', cleaned)
        self.assertNotIn('style=', cleaned)
        self.assertIn('<td>x</td>', cleaned)
