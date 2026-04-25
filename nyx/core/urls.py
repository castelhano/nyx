"""urls.py — Rotas do app core."""
from nyx.framework.routing import generate_urls
from django.conf import settings

app_name = "core"

urlpatterns = generate_urls(
    'nyx.core',
    default_path='views.common',
    common=[ "Empresa", "Filial"],
    extra={
    ('Dashboard','views.dashboard'):[{'context':'Index','path':'','name': 'index'},],
},
)

if settings.DEBUG:
    from django.urls import path
    from .views.common import ShowcaseView
    urlpatterns += [path('dev/showcase/', ShowcaseView.as_view(), name='showcase')]
