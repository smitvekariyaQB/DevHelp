from django.urls import path

from . import views

app_name = 'tables'

urlpatterns = [
    path('', views.index, name='index'),
    path('create/', views.create, name='create'),
    path('<int:pk>/duplicate/', views.duplicate_sheet, name='duplicate'),
    path('<int:pk>/', views.edit, name='edit'),
    path('<int:pk>/autosave/', views.autosave, name='autosave'),
    path('<int:pk>/data/', views.sheet_data, name='data'),
    path('<int:pk>/pin/', views.toggle_pin, name='toggle_pin'),
    path('<int:pk>/delete/', views.delete_item, name='delete'),
]
