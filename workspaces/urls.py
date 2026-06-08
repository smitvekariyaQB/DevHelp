from django.urls import path
from . import views

app_name = 'workspaces'

urlpatterns = [
    path('', views.workspace_list, name='list'),
    path('create/', views.workspace_edit, name='create'),
    path('edit/<int:pk>/', views.workspace_edit, name='edit'),
    path('api/delete/', views.api_delete, name='api_delete'),
]
