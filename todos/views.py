import json

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import TodoList, TodoTask
from .services import (
    ensure_default_lists,
    get_active_tasks,
    get_completed_tasks,
    get_tasks_for_list,
)


def _json_body(request):
    if request.body:
        return json.loads(request.body)
    return {}


def _task_payload(task):
    return {
        'id': task.id,
        'title': task.title,
        'notes': task.notes,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'is_completed': task.is_completed,
        'is_important': task.is_important,
        'in_my_day': task.in_my_day,
        'list_id': task.todo_list_id,
    }


def _list_payload(todo_list, active_count):
    return {
        'id': todo_list.id,
        'title': todo_list.title,
        'color': todo_list.color,
        'smart_type': todo_list.smart_type,
        'is_smart': todo_list.is_smart,
        'active_count': active_count,
    }


@login_required
def index(request):
    ensure_default_lists(request.user)
    lists = request.user.todo_lists.all()
    selected_id = request.GET.get('list')
    if selected_id:
        current_list = get_object_or_404(TodoList, pk=selected_id, user=request.user)
    else:
        current_list = lists.first()

    active_tasks = get_active_tasks(request.user, current_list) if current_list else []
    completed_tasks = get_completed_tasks(request.user, current_list) if current_list else []

    list_data = []
    for todo_list in lists:
        count = get_active_tasks(request.user, todo_list).count()
        list_data.append({**_list_payload(todo_list, count), 'selected': todo_list.pk == current_list.pk})

    return render(
        request,
        'todos/index.html',
        {
            'lists': list_data,
            'current_list': current_list,
            'active_tasks': active_tasks,
            'completed_tasks': completed_tasks,
        },
    )


@login_required
@require_http_methods(['POST'])
def list_create(request):
    data = _json_body(request)
    title = (data.get('title') or 'New list').strip()[:120]
    color = data.get('color') or '#5856D6'
    max_order = request.user.todo_lists.count()
    todo_list = TodoList.objects.create(
        user=request.user,
        title=title,
        color=color,
        order=max_order,
    )
    return JsonResponse({'list': _list_payload(todo_list, 0)})


@login_required
@require_http_methods(['POST'])
def list_delete(request, list_id):
    todo_list = get_object_or_404(TodoList, pk=list_id, user=request.user)
    if todo_list.is_smart:
        return JsonResponse({'error': 'Cannot delete built-in lists'}, status=400)
    todo_list.delete()
    return JsonResponse({'ok': True})


@login_required
@require_http_methods(['POST'])
def task_create(request):
    data = _json_body(request)
    list_id = data.get('list_id')
    todo_list = get_object_or_404(TodoList, pk=list_id, user=request.user)
    title = (data.get('title') or '').strip()
    if not title:
        return JsonResponse({'error': 'Title required'}, status=400)

    task_kwargs = {
        'user': request.user,
        'title': title,
        'order': get_tasks_for_list(request.user, todo_list).count(),
    }
    if not todo_list.is_smart:
        task_kwargs['todo_list'] = todo_list
    else:
        default_list = request.user.todo_lists.filter(smart_type='').first()
        task_kwargs['todo_list'] = default_list

    if todo_list.smart_type == TodoList.SMART_MY_DAY:
        task_kwargs['in_my_day'] = True
    if todo_list.smart_type == TodoList.SMART_IMPORTANT:
        task_kwargs['is_important'] = True

    task = TodoTask.objects.create(**task_kwargs)
    return JsonResponse({'task': _task_payload(task)})


@login_required
@require_http_methods(['POST'])
def task_toggle(request, task_id):
    task = get_object_or_404(TodoTask, pk=task_id, user=request.user)
    task.is_completed = not task.is_completed
    task.completed_at = timezone.now() if task.is_completed else None
    task.save(update_fields=['is_completed', 'completed_at'])
    return JsonResponse({'task': _task_payload(task)})


@login_required
@require_http_methods(['POST'])
def task_update(request, task_id):
    task = get_object_or_404(TodoTask, pk=task_id, user=request.user)
    data = _json_body(request)

    if 'title' in data:
        task.title = data['title'].strip()[:255]
    if 'notes' in data:
        task.notes = data['notes']
    if 'due_date' in data:
        task.due_date = data['due_date'] or None
    if 'is_important' in data:
        task.is_important = bool(data['is_important'])
    if 'in_my_day' in data:
        task.in_my_day = bool(data['in_my_day'])

    task.save()
    return JsonResponse({'task': _task_payload(task)})


@login_required
@require_http_methods(['POST'])
def task_delete(request, task_id):
    task = get_object_or_404(TodoTask, pk=task_id, user=request.user)
    task.delete()
    return JsonResponse({'ok': True})
