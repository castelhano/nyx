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
