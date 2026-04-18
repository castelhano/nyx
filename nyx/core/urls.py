"""urls.py — Rotas do app core."""
from nyx.framework.routing import generate_urls

app_name = "core"

urlpatterns = generate_urls(
    'nyx.core',
    default_path='views.common',
    common=[ "Empresa"],
    # common=[ "Empresa", "Filial"],
    extra={
    ('Dashboard','views.dashboard'):[{'context':'Index','path':'','name': 'index'},],
},
)