from django.contrib import admin

from .models import TodoList, TodoTask


@admin.register(TodoList)
class TodoListAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'smart_type', 'order')
    list_filter = ('smart_type',)


@admin.register(TodoTask)
class TodoTaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'todo_list', 'is_completed', 'is_important', 'in_my_day')
    list_filter = ('is_completed', 'is_important')
