from django.urls import path

from . import views

app_name = 'todos'

urlpatterns = [
    path('', views.index, name='index'),
    path('api/lists/', views.list_create, name='list_create'),
    path('api/lists/<int:list_id>/update/', views.list_update, name='list_update'),
    path('api/lists/<int:list_id>/delete/', views.list_delete, name='list_delete'),
    path('api/tasks/', views.task_create, name='task_create'),
    path('api/tasks/<int:task_id>/toggle/', views.task_toggle, name='task_toggle'),
    path('api/tasks/<int:task_id>/update/', views.task_update, name='task_update'),
    path('api/tasks/<int:task_id>/delete/', views.task_delete, name='task_delete'),
]
