"""
views.py — Classes base para views genéricas do Nyx.

Todas as views de CRUD dos apps devem herdar destas classes.
A configuração visual é feita via ui_schema (classe declarativa em app/ui/).

Personalização > Convenção:
    1. ui_schema declarado na view → usa este
    2. Não declarado → descobre automaticamente via registry (app/ui/modelo.py)
    3. Sem UI em nenhum dos dois → contexto sem 'ui'

Exemplo de uso mínimo (UI descoberta automaticamente):

    class EmpresaListView(BaseListView):
        model = Empresa

Exemplo com override:

    class EmpresaListView(BaseListView):
        model     = Empresa
        ui_schema = EmpresaUI          # sobrescreve a descoberta automática
        queryset  = Empresa.objects.select_related('filial')
"""

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin, PermissionRequiredMixin
from django.http import HttpResponse
from django.shortcuts import redirect
from django.urls import reverse
from django.views.generic import ListView, CreateView, UpdateView, DeleteView

from nyx.framework import messages as nyx_msg
from nyx.framework.mixins.breadcrumbs import BreadcrumbMixin, BreadcrumbItem
from nyx.framework.mixins.scoping import FilialScopeMixin
from nyx.framework.registry import get_nav
from nyx.framework.ui import (
    FormLayout, ListLayout, normalize_columns, filter_sections, resolve_toolbar,
)

# Mapeamento de _permission_action → contexto de UI
_VIEW_CONTEXT = {
    'view':   'list',
    'add':    'create',
    'change': 'update',
    'delete': 'delete',
}


class NyxBaseMixin(LoginRequiredMixin, PermissionRequiredMixin, FilialScopeMixin, BreadcrumbMixin):
    """
    Mixin base aplicado a todas as views do sistema.

    Responsabilidades:
        - Autenticação obrigatória (LoginRequiredMixin)
        - Verificação de permissão (PermissionRequiredMixin)
        - Escopo automático por filial (FilialScopeMixin)
        - Injeção do ui_schema no contexto do template

    permission_required:
        Não declarado  → inferido automaticamente por convenção (app.action_model)
        "app.perm"     → usa o valor declarado
        False          → sem verificação de permissão (qualquer usuário logado acessa)
    """

    # Definido por cada Base*View — usado na inferência automática de permissão
    _permission_action: str | None = None

    # False → view pública (login não exigido)
    login_required = True

    def dispatch(self, request, *args, **kwargs):
        if not self.login_required:
            return super(LoginRequiredMixin, self).dispatch(request, *args, **kwargs)
        return super().dispatch(request, *args, **kwargs)

    def get_permission_required(self):
        pr = self.permission_required
        if pr is False:
            return ()
        if pr is not None:
            return (pr,) if isinstance(pr, str) else pr
        action = self._permission_action
        model  = getattr(self, 'model', None)
        if action and model:
            return (f'{model._meta.app_label}.{action}_{model._meta.model_name}',)
        return ()

    def get_success_url(self):
        if getattr(self, 'success_url', None):
            return str(self.success_url)
        model = self.model
        return reverse(f'{model._meta.app_label}:{model._meta.model_name}_list')

    def _get_schema(self):
        """Personalização > Convenção: view explícita > auto-descoberta via registry."""
        explicit = getattr(self, 'ui_schema', None)
        if explicit is not None:
            return explicit
        model = getattr(self, 'model', None)
        if model:
            entry = get_nav(model)
            if entry:
                return entry.ui
        return None

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['base_template'] = 'layout/fragment.html' if self.request.htmx else 'layout/base.html'

        schema = self._get_schema()
        if schema is None:
            return ctx

        model        = getattr(self, 'model', None)
        view_context = _VIEW_CONTEXT.get(self._permission_action, '')

        model_verbose = self.model._meta.verbose_name_plural.capitalize() if model else ''
        ctx['ui'] = {
            'icon':        getattr(schema, 'icon', ''),
            'title':       getattr(schema, 'title', model_verbose),
            'view':        view_context,
            'layout':      getattr(schema, 'layout', FormLayout() if view_context in ('create', 'update') else ListLayout()),
            'columns':     normalize_columns(getattr(schema, 'columns', [])),
            'toolbar':     resolve_toolbar(schema, model, view_context) if model else [],
            'row_actions': getattr(schema, 'row_actions', []),
            'sections':    filter_sections(getattr(schema, 'sections', []), view_context),
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
    _permission_action = 'view'
    template_name      = "generic/list.html"
    paginate_by        = 25


class BaseCreateView(NyxBaseMixin, CreateView):
    """
    View de criação genérica.
    Template padrão: generic/form.html
    """
    _permission_action = 'add'
    template_name      = "generic/form.html"

    def get_breadcrumb_extra(self):
        verbose = self.model._meta.verbose_name.capitalize()
        return [BreadcrumbItem(label=f'Novo {verbose}')]

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['cancel_url'] = ctx.get('back_url') or self.get_success_url()
        return ctx

    def form_valid(self, form):
        super().form_valid(form)
        msg = getattr(self, 'success_message', None) or nyx_msg.CREATED.format(
            model=self.model._meta.verbose_name.capitalize()
        )
        messages.success(self.request, msg)
        if self.request.htmx:
            response = HttpResponse()
            response['HX-Redirect'] = self.get_success_url()
            return response
        return redirect(self.get_success_url())

    def form_invalid(self, form):
        messages.error(self.request, nyx_msg.FORM_ERROR)
        return super().form_invalid(form)


class BaseUpdateView(NyxBaseMixin, UpdateView):
    """
    View de edição genérica.
    Template padrão: generic/form.html
    """
    _permission_action = 'change'
    template_name      = "generic/form.html"

    def get_breadcrumb_extra(self):
        obj = self.get_object()
        return [BreadcrumbItem(label=str(obj))]

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['cancel_url'] = ctx.get('back_url') or self.get_success_url()
        return ctx

    def form_valid(self, form):
        super().form_valid(form)
        msg = getattr(self, 'success_message', None) or nyx_msg.UPDATED.format(
            model=self.model._meta.verbose_name.capitalize()
        )
        messages.success(self.request, msg)
        if self.request.htmx:
            response = HttpResponse()
            response['HX-Redirect'] = self.get_success_url()
            return response
        return redirect(self.get_success_url())

    def form_invalid(self, form):
        messages.error(self.request, nyx_msg.FORM_ERROR)
        return super().form_invalid(form)


class BaseDeleteView(NyxBaseMixin, DeleteView):
    """
    View de exclusão genérica.
    Template padrão: generic/confirm_delete.html
    """
    _permission_action = 'delete'
    template_name      = "generic/confirm_delete.html"

    def form_valid(self, form):
        msg = getattr(self, 'success_message', None) or nyx_msg.DELETED.format(
            model=self.model._meta.verbose_name.capitalize()
        )
        response = super().form_valid(form)
        messages.success(self.request, msg)
        return response
