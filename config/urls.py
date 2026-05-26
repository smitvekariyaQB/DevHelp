from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', RedirectView.as_view(pattern_name='todos:index', permanent=False)),
    path('accounts/', include('accounts.urls')),
    path('todos/', include('todos.urls')),
    path('notes/', include('notes.urls')),
    path('tables/', include('tables.urls')),
    path('json/', include('jsondocs.urls')),
]
