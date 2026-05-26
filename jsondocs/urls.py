from django.urls import path

from . import views

app_name = 'jsondocs'

urlpatterns = [
    path('', views.index, name='index'),
    path('api/create/', views.doc_create, name='doc_create'),
    path('api/<int:pk>/autosave/', views.doc_autosave, name='doc_autosave'),
    path('api/<int:pk>/delete/', views.doc_delete, name='doc_delete'),
]
