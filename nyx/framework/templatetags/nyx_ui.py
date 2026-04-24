"""
nyx_ui.py — Template tags para renderização de componentes UI genéricos.

Tags disponíveis:
    {% action_button action obj %}   — renderiza botão de ação com checagem de permissão
    {% get_field obj field %}        — resolve campo com suporte a __ (ex: "empresa__nome")

Exemplo no template genérico:
    {% load nyx_ui %}

    {% for action in ui.toolbar %}
        {% action_button action %}
    {% endfor %}

    {% for obj in object_list %}
        {% for col in ui.columns %}
            <td>{% get_field obj col.field %}</td>
        {% endfor %}
        {% for action in ui.row_actions %}
            {% action_button action obj %}
        {% endfor %}
    {% endfor %}
"""

from django import template
from django.urls import reverse, NoReverseMatch

register = template.Library()


@register.inclusion_tag("generic/_action_button.html", takes_context=True)
def action_button(context, action, obj=None):
    """
    Renderiza um botão de ação verificando permissão do usuário.

    A action deve ser uma instância de nyx.framework.ui.Action com:
        label      — texto do botão
        url_name   — nome da URL (ex: "core:filial_update")
        permission — permissão exigida (ex: "core.change_filial"), ou "" para nenhuma
        condition  — nome de atributo booleano no obj (ex: "ativo"), ou ""
        style      — "default" | "primary" | "danger"
        icon       — string de ícone (CSS class ou emoji)
    """
    user = context["request"].user

    if action.permission and not user.has_perm(action.permission):
        return {"visible": False}

    if action.condition and obj:
        if not getattr(obj, action.condition, True):
            return {"visible": False}

    url = ""
    if action.url_name:
        try:
            url = reverse(action.url_name, args=[obj.pk]) if obj else reverse(action.url_name)
        except NoReverseMatch:
            url = "#"

    css_class = action.css_class or (f'btn btn-sm btn-{action.variant}' if action.variant else 'btn btn-sm btn-secondary')
    title     = action.title or action.label or ''

    return {
        "visible":   True,
        "action":    action,
        "url":       url,
        "css_class": css_class,
        "title":     title,
    }


@register.filter(name='form_field')
def form_field(form, field_name):
    """Retorna o BoundField pelo nome. Ex: {{ form|form_field:section_field.name }}"""
    try:
        return form[field_name]
    except KeyError:
        return None


@register.filter(name='add_class')
def add_class(field, css_class):
    """Renderiza o widget adicionando css_class e is-invalid quando o campo tiver erros."""
    existing = field.field.widget.attrs.get('class', '')
    classes  = f'{existing} {css_class}'.strip() if existing else css_class
    if field.errors:
        classes += ' is-invalid'
    return field.as_widget(attrs={'class': classes})


@register.simple_tag(takes_context=True)
def sort_url(context, field):
    """Gera URL de ordenação preservando q atual e alternando asc/desc."""
    from urllib.parse import urlencode
    q      = context.get('current_q', '')
    c_sort = context.get('current_sort', '')
    c_ord  = context.get('current_order', 'asc')
    order  = 'desc' if (c_sort == field and c_ord == 'asc') else 'asc'
    params = {}
    if q:
        params['q'] = q
    params['sort']  = field
    params['order'] = order
    return '?' + urlencode(params)


@register.simple_tag(takes_context=True)
def page_url(context, page_num):
    """Gera URL de paginação preservando q, sort e order atuais."""
    from urllib.parse import urlencode
    params = {}
    q     = context.get('current_q', '')
    sort  = context.get('current_sort', '')
    order = context.get('current_order', 'asc')
    if q:
        params['q'] = q
    if sort:
        params['sort']  = sort
        params['order'] = order
    params['page'] = page_num
    return '?' + urlencode(params)


@register.simple_tag
def get_field(obj, field_path: str):
    """
    Resolve campo com suporte a traversal por __ .
    Ex: get_field obj "empresa__nome"  →  obj.empresa.nome
    """
    value = obj
    for part in field_path.split("__"):
        if value is None:
            return ""
        value = getattr(value, part, "")
    return value if value is not None else ""
