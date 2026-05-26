import uuid

from django.conf import settings
from django.db import models


def default_sheet_data():
    columns = [
        {'id': str(uuid.uuid4()), 'width': 160, 'label': f'Column {i + 1}'}
        for i in range(3)
    ]
    rows = [
        {'id': str(uuid.uuid4()), 'cells': {col['id']: '' for col in columns}}
        for _ in range(5)
    ]
    return {'columns': columns, 'rows': rows}


class TableSheet(models.Model):
    COLORS = [
        ('#FFFFFF', 'White'),
        ('#FFF9C4', 'Yellow'),
        ('#FFE0B2', 'Orange'),
        ('#F8BBD0', 'Pink'),
        ('#E1BEE7', 'Purple'),
        ('#BBDEFB', 'Blue'),
        ('#C8E6C9', 'Green'),
        ('#F5F5F5', 'Gray'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='table_sheets',
    )
    title = models.CharField(max_length=200, default='Untitled table')
    color = models.CharField(max_length=7, default='#FFFFFF')
    data = models.JSONField(default=default_sheet_data)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.title

    @property
    def preview(self):
        rows = self.data.get('rows', [])
        cols = self.data.get('columns', [])
        size = f'{len(rows)}×{len(cols)}'
        for row in rows:
            for cell in row.get('cells', {}).values():
                text = (cell or '').strip()
                if text:
                    snippet = text.replace('\n', ' ')[:80]
                    return f'{size} · {snippet}'
        return f'{size} · Empty table'
