from django.urls import path

from . import views

app_name = 'notes'

urlpatterns = [
    path('', views.index, name='index'),
    path('create/', views.create, name='create'),
    path('<int:pk>/', views.edit, name='edit'),
    path('<int:pk>/autosave/', views.autosave, name='autosave'),
    path('<int:pk>/color/', views.update_color, name='update_color'),
]
