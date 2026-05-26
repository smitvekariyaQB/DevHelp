from django.contrib import admin

from .models import TableSheet


@admin.register(TableSheet)
class TableSheetAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'updated_at')
