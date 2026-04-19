"""
registry.py — Registro de navegacao do sistema Nyx.

Centraliza metadados de navegacao de todos os models:
hierarquia (parent/children), acoes disponiveis por nivel,
e tudo mais que o breadcrumb e a sidebar precisam.

O registro e populado automaticamente pelo generate_urls() via _queue(),
e resolvido no AppConfig.ready() do framework via _flush().
Nao e necessario nenhuma configuracao manual na grande maioria dos casos.

FLUXO:
    1. urls.py de cada app chama generate_urls()
    2. generate_urls() chama _queue() para cada model encontrado
    3. Django termina de carregar todos os apps
    4. FrameworkConfig.ready() chama _flush()
    5. _flush() resolve models, infere parents e actions pelas FKs
    6. registry esta pronto para uso

CASOS ESPECIAIS:
    Se a inferencia automatica errar (ex: model com multiplas FKs onde
    o parent semantico nao e o primeiro), declare explicitamente no
    generate_urls:

        common=[
            {
                'model':  'Contrato',
                'parent': 'Cliente',   # sobrescreve inferencia automatica
            },
        ]

    Para models sem parent (raiz da hierarquia), nao e necessario declarar nada.

USO:
    from nyx.framework.registry import get_nav

    nav = get_nav(Funcionario)
    nav.parent     # model pai (ex: Empresa) ou None
    nav.actions    # lista de NavAction para filhos diretos
    nav.list_url   # nome da url de listagem (ex: 'pessoal:funcionario_list')
    nav.app_label  # verbose_name do app (ex: 'Pessoal')
"""

import importlib
from dataclasses import dataclass, field
from django.apps import apps as django_apps


# =============================================================================
# ESTRUTURAS
# =============================================================================

@dataclass
class NavAction:
    """
    Representa uma acao de navegacao disponivel num nivel do breadcrumb.
    Gerada automaticamente pelo flush() para cada model filho.

    Atributos:
        label    — texto exibido no dropdown (verbose_name_plural do model filho)
        url_name — nome completo da url (ex: 'pessoal:afastamento_list')
        pk_kwarg — nome do kwarg de pk na url (ex: 'funcionario_pk')
        icon     — icone opcional para exibicao no dropdown
    """
    label:    str
    url_name: str
    pk_kwarg: str = 'pk'
    icon:     str = ''


@dataclass
class NavEntry:
    """
    Entrada completa de navegacao para um model.

    Gerada automaticamente pelo flush() e armazenada no _registry.
    Acesse via get_nav(Model).

    Atributos:
        model     — a classe do model Django
        app_label — verbose_name do AppConfig (ex: 'Pessoal')
        list_url  — nome da url de listagem
        parent    — model pai na hierarquia ou None
        actions   — NavActions para filhos diretos (exibidos no dropdown)
        meta      — dados extras vindos do generate_urls (lookup, etc.)
    """
    model:     object
    app_label: str       = ''
    list_url:  str       = ''
    parent:    object    = None
    actions:   list      = field(default_factory=list)
    meta:      dict      = field(default_factory=dict)
    ui:        object    = None   # classe UI descoberta de app/ui/modelo.py


# =============================================================================
# ESTADO INTERNO
# =============================================================================

# Registro final: { ModelClass: NavEntry }
_registry: dict = {}

# Registro de AppUI: { app_label_short: AppUI class }
_app_ui_registry: dict = {}

# Fila de intencoes vindas do generate_urls antes do ready()
# Cada item: (model_name, app_name, extra_meta)
# ex: ('Funcionario', 'nyx.pessoal', {'parent': 'Empresa', 'lookup': 'int:pk'})
_pending: list = []

_flushed:  bool = False


# =============================================================================
# API PUBLICA
# =============================================================================

def get_nav(model) -> NavEntry | None:
    """
    Retorna a NavEntry de um model, ou None se nao registrado.
    Uso:
        nav = get_nav(Funcionario)
        if nav:
            print(nav.parent, nav.actions)
    """
    global _flushed
    if not _flushed:
        _flush()
        _flushed = True
    return _registry.get(model)

def get_all() -> dict:
    """Retorna o registry completo. Util para debug e geracao de sidebar."""
    global _flushed
    if not _flushed:
        _flush()
        _flushed = True
    return _registry

def get_app_ui(app_label: str):
    """Retorna a classe AppUI do app, ou None se não configurada."""
    global _flushed
    if not _flushed:
        _flush()
        _flushed = True
    return _app_ui_registry.get(app_label)


# =============================================================================
# API INTERNA (usada pelo generate_urls e pelo AppConfig)
# =============================================================================

def _queue(model_name: str, app_name: str, meta: dict = None):
    """
    Enfileira um model para registro posterior.
    Chamado pelo generate_urls() durante a importacao dos urls.py.

    Pode ser chamado mais de uma vez para o mesmo model (o urls.py pode
    ser importado duas vezes — uma pelo FrameworkConfig.ready() e outra
    pelo Django no roteamento). O _flush() deduplica antes de processar.

    Args:
        model_name — nome da classe do model (ex: 'Empresa')
        app_name   — caminho completo do app (ex: 'nyx.core')
        meta       — dados extras do generate_urls (parent declarado, lookup, etc.)
    """
    _pending.append((model_name, app_name, meta or {}))


def _flush():
    """
    Resolve todas as intencoes enfileiradas e popula o _registry.
    Chamado pelo FrameworkConfig.ready() apos todos os apps carregarem,
    que forcou a importacao dos urls.py via importlib para garantir
    que os _queue() foram executados antes do flush.

    Deduplica o _pending antes de processar — o mesmo model pode ter
    sido enfileirado mais de uma vez se o urls.py foi importado multiplas
    vezes (comportamento normal do Django).

    Processo:
        1. Deduplica _pending por (model_name, app_name)
        2. Resolve cada model_name para a classe Django
        3. Infere parent pela logica de prioridade (ver _infer_parent)
        4. Infere actions pelos models que apontam FK para este model
        5. Popula _registry com NavEntry completo para cada model
    """
    
    seen = {}
    for item in _pending:
        seen[(item[0], item[1])] = item
    unique = list(seen.values())

    # Passo 1 — resolve todas as classes primeiro
    resolved: dict = {}  # { ModelClass: meta_dict }

    for model_name, app_name, meta in unique:
        # app_name pode ser 'nyx.pessoal' — o app_label do Django e so 'pessoal'
        app_label_short = app_name.split('.')[-1]
        try:
            model_class = django_apps.get_model(app_label_short, model_name)
            resolved[model_class] = {**meta, '_app_name': app_name}
        except LookupError:
            # Model nao encontrado — app pode nao ter o model ainda (migracao pendente)
            continue

    # Passo 2 — infere parents
    # Para cada model, procura a primeira FK que aponta para outro model registrado
    for model_class, meta in resolved.items():
        if 'parent' not in meta:
            meta['parent'] = _infer_parent(model_class, resolved)
        elif isinstance(meta['parent'], str):
            # Parent foi declarado como string — resolve para classe
            meta['parent'] = _resolve_model_by_name(meta['parent'], resolved)

    # Passo 3 — monta NavEntries e infere actions
    for model_class, meta in resolved.items():
        app_name_full = meta['_app_name']
        app_label_short = app_name_full.split('.')[-1]

        # verbose_name do AppConfig (ex: 'Pessoal')
        try:
            app_config = django_apps.get_app_config(app_label_short)
            app_verbose = str(app_config.verbose_name)
        except LookupError:
            app_verbose = app_label_short.capitalize()

        # URL de listagem inferida pela convencao do generate_urls
        model_name_lower = model_class._meta.model_name
        list_url = f"{app_label_short}:{model_name_lower}_list"

        # Actions — models que apontam FK para este model (filhos diretos)
        actions = _infer_actions(model_class, resolved, app_label_short)

        _registry[model_class] = NavEntry(
            model     = model_class,
            app_label = app_verbose,
            list_url  = list_url,
            parent    = meta.get('parent'),
            actions   = actions,
            meta      = {k: v for k, v in meta.items()
                         if k not in ('parent', '_app_name')},
            ui        = _discover_ui(app_name_full, model_class.__name__),
        )

        if app_label_short not in _app_ui_registry:
            _app_ui_registry[app_label_short] = _discover_app_ui(app_name_full, app_label_short)

    _pending.clear()


# =============================================================================
# HELPERS INTERNOS
# =============================================================================

def _infer_parent(model_class, resolved: dict):
    """
    Resolve o model pai seguindo a hierarquia de prioridade:

        1. Meta.nav_parent declarado no model (nome do campo FK)
           Uso: quando o model tem multiplas FKs e o parent semantico
           nao seria inferido corretamente de forma automatica.

               class Contrato(models.Model):
                   cliente  = models.ForeignKey(Cliente, ...)
                   vendedor = models.ForeignKey(Funcionario, ...)
                   class Meta:
                       nav_parent = 'cliente'  # nome do campo, nao da classe

        2. Primeira FK para model do mesmo app registrado no registry.
           Cobre a grande maioria dos casos sem nenhuma configuracao.

        3. Primeira FK para model de outro app registrado no registry.
           Fallback para relacoes cross-app (ex: model de operacao
           apontando para model de core).

        4. None — model raiz da hierarquia, sem parent.

    Nota: o override via 'parent' no generate_urls tem prioridade sobre
    tudo isso — e aplicado antes mesmo de chamar esta funcao (no _flush).
    """
    # 1. Meta.nav_parent declarado explicitamente no model
    nav_parent = getattr(model_class._meta, 'nav_parent', None)
    if nav_parent:
        field = model_class._meta.get_field(nav_parent)
        related = getattr(field, 'related_model', None)
        if related and related in resolved:
            return related

    # 2. Inferencia automatica — prioriza FK para model do mesmo app
    same_app, other = [], []
    for f in model_class._meta.get_fields():
        if not (hasattr(f, 'many_to_one') and f.many_to_one):
            continue
        related = getattr(f, 'related_model', None)
        if related and related in resolved and related is not model_class:
            (same_app if related._meta.app_label == model_class._meta.app_label
                      else other).append(related)

    candidates = same_app or other
    return candidates[0] if candidates else None


def _infer_actions(model_class, resolved: dict, app_label_short: str) -> list:
    """
    Retorna NavActions para cada model filho (que tem FK apontando para model_class).
    So considera models do mesmo app.
    """
    actions = []
    for other_model, other_meta in resolved.items():
        if other_model is model_class:
            continue
        parent = other_meta.get('parent')
        if parent is not model_class:
            continue

        # Nome do kwarg de pk na URL do filho
        # ex: Funcionario -> 'funcionario_pk'
        pk_kwarg = f"{model_class._meta.model_name}_pk"

        # Verifica se o related usa lookup customizado
        lookup = other_meta.get('lookup', '')
        if lookup:
            # ex: 'int:funcionario_pk' -> extrai o nome
            pk_kwarg = lookup.split(':')[-1] if ':' in lookup else lookup

        other_name_lower = other_model._meta.model_name
        actions.append(NavAction(
            label    = str(other_model._meta.verbose_name_plural).capitalize(),
            url_name = f"{app_label_short}:{other_name_lower}_list",
            pk_kwarg = pk_kwarg,
        ))

    return actions


def _discover_ui(app_name: str, model_name: str):
    """
    Tenta importar {app}.ui.{model_snake} e retorna a classe {ModelName}UI.
    Retorna None silenciosamente se o arquivo não existir.
    Erros internos ao módulo são logados em DEBUG para não suprimir bugs.
    """
    import logging
    module_path = f"{app_name}.ui.{model_name.lower()}"
    try:
        module = importlib.import_module(module_path)
        return getattr(module, f"{model_name}UI", None)
    except ImportError:
        return None
    except Exception:
        logging.getLogger('nyx').debug(
            f'Erro ao descobrir UI para {module_path}', exc_info=True
        )
        return None


def _discover_app_ui(app_name: str, app_label_short: str):
    """
    Tenta importar {app}.ui.app e retorna a classe AppUI.
    Convenção: nyx.core.ui.app → AppUI
    Retorna None silenciosamente se o arquivo não existir.
    """
    import logging
    module_path = f"{app_name}.ui.app"
    try:
        module = importlib.import_module(module_path)
        return getattr(module, 'AppUI', None)
    except ImportError:
        return None
    except Exception:
        logging.getLogger('nyx').debug(
            f'Erro ao descobrir AppUI para {module_path}', exc_info=True
        )
        return None


def _resolve_model_by_name(name: str, resolved: dict):
    """Resolve uma string de nome de model para a classe, buscando no resolved."""
    for model_class in resolved:
        if model_class.__name__ == name:
            return model_class
    return None
