from django.urls import path

from . import views

app_name = 'markdown'

urlpatterns = [
    path('', views.index, name='index'),
]
