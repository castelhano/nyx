"""
routing.py — Geracao dinamica de URLPatterns por convencao.

Alem de gerar as URLs, enfileira cada model no registry de navegacao
(framework/registry.py) para uso posterior pelo breadcrumb e sidebar.
O registry e resolvido no FrameworkConfig.ready(), apos todos os apps
estarem carregados.

----------------------------------------------------------------------------
USO BASICO
----------------------------------------------------------------------------

    from nyx.framework.routing import generate_urls

    app_name = 'nyx.pessoal'

    urlpatterns = generate_urls(
        app_name,
        common=[
            'Setor',
            'Funcionario',
        ],
        related=[
            {'model': 'Afastamento', 'lookup': 'int:funcionario_pk'},
            {'model': 'Dependente',  'lookup': 'int:funcionario_pk'},
        ],
        extra={
            ('Dashboard', 'views.dashboard'): [
                {'context': 'Index', 'path': '', 'name': 'index'},
            ],
        },
    )

    # Fora do generate_urls, para o namespace funcionar:
    app_name = 'pessoal'

----------------------------------------------------------------------------
CONVENCOES DE NOMENCLATURA
----------------------------------------------------------------------------

Classes de view esperadas:
    CRUD    — ModeloListView, ModeloCreateView, ModeloUpdateView, ModeloDeleteView
    Extra   — ModeloContextView  ou  ModeloContext  (sem sufixo, fallback)
              Com suffix declarado: ModeloContextSuffix (busca estrita)

URLs geradas (common):
    modelo/list/            → name: modelo_list
    modelo/new/             → name: modelo_create
    modelo/<int:pk>/update/ → name: modelo_update
    modelo/<int:pk>/delete/ → name: modelo_delete

URLs geradas (related, ex: lookup='int:funcionario_pk'):
    modelo/<int:funcionario_pk>/list/  → name: modelo_list
    modelo/<int:funcionario_pk>/new/   → name: modelo_create
    modelo/<int:pk>/update/            → name: modelo_update
    modelo/<int:pk>/delete/            → name: modelo_delete

----------------------------------------------------------------------------
PARENT EXPLICITO (quando a inferencia automatica nao for suficiente)
----------------------------------------------------------------------------

    common=[
        {
            'model':  'Contrato',
            'parent': 'Cliente',   # sobrescreve inferencia por FK
        },
    ]

    Util quando o model tem multiplas FKs e o parent semantico
    nao e o primeiro campo declarado.
"""

from django.urls import path
from importlib import import_module

from nyx.framework import registry


# =============================================================================
# PONTO DE ENTRADA
# =============================================================================

def generate_urls(app_name: str, default_path: str = 'views', **kwargs) -> list:
    """
    Gera URLPatterns e enfileira models no registry de navegacao.

    Args:
        app_name     — caminho completo do app (ex: 'nyx.pessoal').
                       Usado tanto para importar os modulos de views
                       quanto para montar os nomes das URLs.
        default_path — modulo padrao onde buscar as views (default: 'views').
                       Pode ser sobrescrito por item via 'path_module'.
        common       — lista de models CRUD sem lookup de pai.
        related      — lista de models CRUD com lookup de pai na URL.
        extra        — dict de views fora do padrao CRUD.

    Returns:
        Lista de URLPattern prontos para atribuir a urlpatterns.
    """
    urls = []
    urls += _process_cruds(kwargs.get('common', []),  app_name, default_path, is_related=False)
    urls += _process_cruds(kwargs.get('related', []), app_name, default_path, is_related=True)
    urls += _process_extras(kwargs.get('extra', {}),  app_name, default_path)
    return urls


# =============================================================================
# PROCESSAMENTO DE CRUDS
# =============================================================================

def _process_cruds(models_list: list, app_name: str, default_path: str,
                   is_related: bool) -> list:
    """
    Gera rotas CRUD para cada model da lista e enfileira no registry.

    Aceita cada item como:
        'Funcionario'                           — string simples
        {'model': 'Funcionario', 'lookup': ...} — dict com opcoes
    """
    urls = []

    for item in models_list:
        cfg      = {'model': item} if isinstance(item, str) else item
        name     = cfg['model']
        path_mod = cfg.get('path_module', default_path)
        lookup   = cfg.get('lookup', 'int:pk')
        singular = name.lower()
        prefix   = f'<{lookup}>/' if is_related else ''
        print(f"_queue chamado: {name}, {app_name}")  # <--

        # Enfileira no registry — resolvido depois pelo flush()
        registry._queue(name, app_name, {
            'lookup': lookup,
            'parent': cfg.get('parent'),   # None se nao declarado — inferido pelo flush
        })

        crud_map = [
            ('ListView',   'list/',   '_list',   prefix),
            ('CreateView', 'new/',    '_create', prefix),
            ('UpdateView', 'update/', '_update', f'<{lookup}>/'),
            ('DeleteView', 'delete/', '_delete', f'<{lookup}>/'),
        ]

        for context_name, url_tail, name_tail, pk_part in crud_map:
            view_class = _get_view_class(app_name, path_mod, name, context_name)
            if view_class:
                urls.append(path(
                    f'{singular}/{pk_part}{url_tail}',
                    view_class.as_view(),
                    name=f'{singular}{name_tail}',
                ))

    return urls


# =============================================================================
# PROCESSAMENTO DE EXTRAS
# =============================================================================

def _process_extras(extra_dict: dict, app_name: str, default_path: str) -> list:
    """
    Gera rotas para views fora do padrao CRUD.

    Chave do dict:
        'Modelo'                    — busca no default_path
        ('Modelo', 'views.modulo') — busca no modulo especificado

    Valor — lista de strings ou dicts:
        'Manage'   → busca ModeloManageView, path: manage/, name: modelo_manage
        {
            'context': 'Report',
            'suffix':  'Data',     — busca ModeloReportData (estrito)
            'path':    'pdf/',
            'name':    'modelo_pdf',
        }

    Extras nao sao enfileirados no registry — nao representam models CRUD.
    """
    urls = []

    for model_key, views in extra_dict.items():
        model_name    = model_key[0] if isinstance(model_key, tuple) else model_key
        path_mod_root = (model_key[1] if isinstance(model_key, tuple) else None) or default_path

        for item in views:
            cfg         = {'context': item} if isinstance(item, str) else item
            context     = cfg.get('context', '')
            path_mod    = cfg.get('path_module', path_mod_root)
            url_pattern = cfg.get('path', f'{context.lower()}/')
            url_name    = cfg.get('name', f'{model_name.lower()}_{context.lower()}')
            custom_sfx  = cfg.get('suffix', None)

            view_class = _get_view_class(app_name, path_mod, model_name, context, custom_sfx)
            if view_class:
                urls.append(path(url_pattern, view_class.as_view(), name=url_name))

    return urls


# =============================================================================
# RESOLUCAO DE CLASSES DE VIEW
# =============================================================================

def _get_view_class(app_name: str, path_str: str, model: str,
                    context: str, custom_suffix=None):
    """
    Importa o modulo e retorna a classe de view pelo nome convencional.

    Sem suffix:
        1. Busca ModelContextView
        2. Fallback: ModelContext (sem 'View' no nome)
    Com suffix (busca estrita, sem fallback):
        Busca ModelContextSuffix

    Retorna None silenciosamente se o modulo nao existir ou a classe
    nao for encontrada — o CRUD simplesmente nao gera aquela rota.
    """
    module_path = f'{app_name}.{path_str}'
    try:
        mod = import_module(module_path)
    except ImportError:
        return None

    if custom_suffix is not None:
        # Busca estrita com suffix declarado
        return getattr(mod, f'{model}{context}{custom_suffix}', None)

    # Busca padrao: tenta com 'View', fallback sem sufixo
    view = getattr(mod, f'{model}{context}View', None)
    if not view:
        view = getattr(mod, f'{model}{context}', None)
    return view