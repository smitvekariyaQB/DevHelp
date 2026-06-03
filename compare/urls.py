from django.urls import path

from . import views

app_name = 'compare'

urlpatterns = [
    path('', views.index, name='index'),
    path('api/files/', views.api_files, name='api_files'),
    path('api/file/', views.api_file, name='api_file'),
]
