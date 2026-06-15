from django.urls import path

from . import views

app_name = 'workspaces'

urlpatterns = [
    path('', views.workspace_list, name='list'),
    path('create/', views.workspace_edit, name='create'),
    path('edit/<int:pk>/', views.workspace_edit, name='edit'),
    path('view/<int:pk>/', views.workspace_view, name='view'),
    path('api/delete/', views.api_delete, name='api_delete'),
    path('<int:pk>/share/', views.share_invite, name='share_invite'),
    path('<int:pk>/share/<int:member_id>/', views.share_manage, name='share_manage'),
    path('invite/<uuid:token>/', views.accept_invite, name='accept_invite'),
]
