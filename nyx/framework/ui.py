"""
ui.py — Dataclasses declarativos para configuração de interface do Nyx.

Uso:
    # app/ui/modelo.py
    class ModeloUI:
        icon     = 'bi-box'
        columns  = ['nome', Column('status', format=lambda v, obj: Badge(...))]
        toolbar  = [Action(keybind=Keybind(keys='alt+n'))]
        sections = [Section('Dados', fields=['nome', Field('codigo', col_span=4)])]

Convenção > personalização:
    O framework descobre ModeloUI automaticamente via app/ui/modelo.py.
    Declarar ui_schema na view sobrescreve a descoberta automática.
"""

from __future__ import annotations
from dataclasses import dataclass, field as dc_field
from typing import Callable


# =============================================================================
# PRIMITIVOS DE RENDERIZAÇÃO
# =============================================================================

@dataclass
class Badge:
    """Célula de tabela renderizada como badge colorido."""
    label:   str
    variant: str = 'secondary'   # success | danger | warning | info | ...


@dataclass
class Link:
    """Célula de tabela renderizada como link."""
    label: str
    url:   str


# =============================================================================
# INTERAÇÃO
# =============================================================================

@dataclass
class Keybind:
    """Atalho de teclado mapeado via data-keybind no elemento."""
    keys:   str
    action: str = ''   # data-action; se vazio o keywatch.js infere click/focus


# =============================================================================
# AÇÕES
# =============================================================================

@dataclass
class Action:
    """
    Ação de toolbar, row_action ou botão de form.

    Todos os atributos têm defaults — declare só o que muda:
        Action(keybind=Keybind(keys='alt+n'))       # url/label inferidos
        Action(url_name='core:export', icon='bi-download')  # ação extra
    """
    label:      str     = ''
    url_name:   str     = ''
    icon:       str     = ''
    variant:    str     = ''
    permission: str     = ''   # se vazio, inferida pelo registry
    condition:  str     = ''   # atributo booleano no obj (ex: 'ativo')
    keybind:    Keybind = None


# =============================================================================
# LAYOUT
# =============================================================================

@dataclass
class ListLayout:
    container_class:        str  = 'p-4'
    table_class:            str  = 'table table-hover table-striped'
    header_class:           str  = ''
    header_title_class:     str  = ''
    header_actions_class:   str  = ''

@dataclass
class FormLayout:
    container_class:        str  = 'p-4'


# =============================================================================
# LIST
# =============================================================================

@dataclass
class Column:
    """
    Coluna de tabela. Use string pura para defaults completos:
        columns = ['nome', Column('status', breakpoint='sm')]
    """
    field:        str
    label:        str      = ''       # vazio → verbose_name do model field
    breakpoint:   str      = ''       # 'sm' | 'md' | 'lg' | 'xl'
    align:        str      = 'start'  # 'start' | 'center' | 'end'
    sortable:     bool     = True
    extra_classes: str     = ''
    format:       Callable = None     # fn(value, obj) → Badge | Link | str


# =============================================================================
# FORM
# =============================================================================

@dataclass
class Field:
    """
    Campo de form. Use string pura para defaults completos:
        fields = ['nome', Field('codigo', col_span=4)]
    """
    name:          str     = ''
    label:         str     = ''       # vazio → verbose_name do model field
    placeholder:   str     = ''
    help_text:     str     = ''       # vazio → help_text do model field
    col_span:      int     = 12
    only:          str     = ''       # 'create' | 'update' | '' (ambos)
    extra_classes: str     = ''
    keybind:       Keybind = None


@dataclass
class Section:
    """
    Seção/aba do form.

    Seções com tab definido são agrupadas como abas pelo template.
    Seções sem tab são renderizadas sequencialmente.

        sections = [
            Section('Dados',    fields=['nome', Field('codigo', col_span=4)]),
            Section('Status',   fields=['ativo'], tab='Config', only='update'),
        ]
    """
    title:    str  = ''
    fields:   list = dc_field(default_factory=list)
    tab:      str  = ''       # se preenchido, agrupa nesta aba
    only:     str  = ''       # 'create' | 'update' | '' (ambos)
    col_span: int  = 12


# =============================================================================
# HELPERS
# =============================================================================

def resolve_attr(obj, field_path: str):
    """Resolve 'empresa__nome' via cadeia de getattr."""
    for part in field_path.split('__'):
        if obj is None:
            return None
        obj = getattr(obj, part, None)
    return obj


def normalize_columns(columns: list) -> list[Column]:
    """Converte strings para Column com defaults."""
    return [Column(field=c) if isinstance(c, str) else c for c in columns]


def normalize_fields(fields: list) -> list[Field]:
    """Converte strings para Field com defaults."""
    return [Field(name=f) if isinstance(f, str) else f for f in fields]


def filter_sections(sections: list[Section], view_context: str) -> list[Section]:
    """
    Filtra seções e campos pelo contexto da view ('create' | 'update' | 'list').
    Seções/campos com only='' passam em qualquer contexto.
    """
    result = []
    for s in sections:
        if s.only and s.only != view_context:
            continue
        visible_fields = [
            f for f in normalize_fields(s.fields)
            if not f.only or f.only == view_context
        ]
        if visible_fields:
            result.append(Section(
                title=s.title,
                fields=visible_fields,
                tab=s.tab,
                col_span=s.col_span,
            ))
    return result


def resolve_toolbar(schema, model, view_context: str) -> list[Action]:
    """
    Resolve o toolbar final para a view.

    - toolbar não declarado + list view → injeta Action de create automático
    - toolbar não declarado + outras views → lista vazia
    - toolbar declarado → normaliza Actions (preenche url_name/label ausentes)
    - toolbar = [] → lista vazia (sem toolbar)
    """
    declared = getattr(schema, 'toolbar', None)
    app_label  = model._meta.app_label
    model_name = model._meta.model_name
    verbose    = str(model._meta.verbose_name).capitalize()

    if declared is None:
        if view_context != 'list':
            return []
        return [Action(
            label    = verbose,
            url_name = f'{app_label}:{model_name}_create',
            icon     = 'bi bi-plus-lg',
        )]

    result = []
    for action in declared:
        if not action.url_name and view_context == 'list':
            action = Action(
                label    = action.label or verbose,
                url_name = f'{app_label}:{model_name}_create',
                icon     = action.icon or 'bi bi-plus-lg',
                variant  = action.variant,
                keybind  = action.keybind,
                permission = action.permission,
            )
        result.append(action)
    return result
