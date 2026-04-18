"""
views.py — Classes base para views genéricas do Nyx.

Todas as views de CRUD dos apps devem herdar destas classes.
A configuração visual é feita via ui_schema (classe declarativa em app/ui/).

Exemplo de uso:

    # operacao/views/viagem.py
    from nyx.framework.views import BaseListView
    from operacao.models import Viagem
    from operacao.ui.viagem import ViagemListUI

    class ViagemListView(BaseListView):
        model        = Viagem
        ui_schema    = ViagemListUI
        queryset     = Viagem.objects.select_related("origem", "destino")
"""

from django.contrib.auth.mixins import LoginRequiredMixin, PermissionRequiredMixin
from django.views.generic import ListView, CreateView, UpdateView, DeleteView

from nyx.framework.mixins.breadcrumbs import BreadcrumbMixin
from nyx.framework.mixins.scoping import FilialScopeMixin


class NyxBaseMixin(LoginRequiredMixin, PermissionRequiredMixin, FilialScopeMixin, BreadcrumbMixin):
    """
    Mixin base aplicado a todas as views do sistema.

    Responsabilidades:
        - Autenticação obrigatória (LoginRequiredMixin)
        - Verificação de permissão (PermissionRequiredMixin)
        - Escopo automático por filial (FilialScopeMixin)
        - Injeção do ui_schema no contexto do template

    Cada view concreta deve declarar:
        permission_required = "app.action_model"
        ui_schema           = MinhaUI  (classe de nyx/framework ou app/ui/)
    """

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        schema = getattr(self, "ui_schema", None)
        if schema:
            ctx["ui"] = {
                "title":          getattr(schema, "title", ""),
                "subtitle":       getattr(schema, "subtitle", ""),
                "icon":           getattr(schema, "icon", ""),
                "columns":        getattr(schema, "columns", []),
                "toolbar":        getattr(schema, "toolbar", []),
                "row_actions":    getattr(schema, "row_actions", []),
                "tabs":           getattr(schema, "tabs", []),
                "search_fields":  getattr(schema, "search_fields", []),
            }
        return ctx


class BaseListView(NyxBaseMixin, ListView):
    """
    View de listagem genérica.
    Template padrão: generic/list.html

    Atributos opcionais:
        paginate_by  (default: 25)
        ordering     (default: definido no model.Meta)
    """
    template_name = "generic/list.html"
    paginate_by   = 25


class BaseCreateView(NyxBaseMixin, CreateView):
    """
    View de criação genérica.
    Template padrão: generic/form.html
    """
    template_name = "generic/form.html"


class BaseUpdateView(NyxBaseMixin, UpdateView):
    """
    View de edição genérica.
    Template padrão: generic/form.html
    """
    template_name = "generic/form.html"


class BaseDeleteView(NyxBaseMixin, DeleteView):
    """
    View de exclusão genérica.
    Template padrão: generic/confirm_delete.html
    """
    template_name = "generic/confirm_delete.html"
