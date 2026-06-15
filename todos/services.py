from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone

from .models import TodoList, TodoTask

User = get_user_model()

DEFAULT_LISTS = [
    {'title': 'My Day', 'color': '#FF9500', 'smart_type': TodoList.SMART_MY_DAY, 'order': 0},
    {'title': 'Important', 'color': '#FF3B30', 'smart_type': TodoList.SMART_IMPORTANT, 'order': 1},
    {'title': 'Tasks', 'color': '#007AFF', 'smart_type': '', 'order': 2},
]


def ensure_default_lists(user, workspace):
    if TodoList.objects.filter(workspace=workspace).exists():
        return
    owner = workspace.user
    for item in DEFAULT_LISTS:
        TodoList.objects.create(user=owner, workspace=workspace, **item)


def get_tasks_for_list(todo_list):
    base = TodoTask.objects.filter(workspace=todo_list.workspace)
    if todo_list.smart_type == TodoList.SMART_MY_DAY:
        return base.filter(in_my_day=True)
    if todo_list.smart_type == TodoList.SMART_IMPORTANT:
        return base.filter(is_important=True)
    return base.filter(todo_list=todo_list)


def get_active_tasks(todo_list):
    return get_tasks_for_list(todo_list).filter(is_completed=False)


def get_completed_tasks(todo_list):
    return get_tasks_for_list(todo_list).filter(is_completed=True)
