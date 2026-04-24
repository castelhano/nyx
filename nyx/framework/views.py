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
    FormLayout, ListLayout, ListConfig, normalize_columns, filter_sections,
    resolve_toolbar, resolve_row_actions, resolve_attr,
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
        url_name = f'{model._meta.app_label}:{model._meta.model_name}_list'
        try:
            return reverse(url_name)
        except Exception:
            from django.core.exceptions import ImproperlyConfigured
            raise ImproperlyConfigured(
                f"{self.__class__.__name__} não encontrou a URL '{url_name}'. "
                "Declare success_url na view ou registre a rota de listagem via generate_urls."
            )

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

        if model:
            meta          = self.model._meta
            model_verbose = (meta.verbose_name_plural if view_context == 'list' else meta.verbose_name).capitalize()
            ctx['app_name'] = meta.app_config.verbose_name
        else:
            model_verbose   = ''
            ctx['app_name'] = ''

        ctx['ui'] = {
            'icon':        getattr(schema, 'icon', ''),
            'title':       getattr(schema, 'title', model_verbose),
            'view':        view_context,
            'layout':      getattr(schema, 'layout', FormLayout() if view_context in ('create', 'update') else ListLayout()),
            'columns':     normalize_columns(getattr(schema, 'columns', [])),
            'toolbar':     resolve_toolbar(schema, model, view_context) if model else [],
            'row_actions': resolve_row_actions(schema, model) if model else [],
            'sections':    filter_sections(getattr(schema, 'sections', []), view_context),
            'list_config': getattr(schema, 'list_config', ListConfig()),
        }
        return ctx


class BaseListView(NyxBaseMixin, ListView):
    """
    View de listagem genérica.
    Template padrão: generic/list.html

    Atributos opcionais:
        paginate_by  (default: ListConfig.page_size → 25)
        ordering     (default: definido no model.Meta)
    """
    _permission_action = 'view'
    template_name      = "generic/list.html"
    paginate_by        = 25

    def get_paginate_by(self, queryset):
        schema = self._get_schema()
        if schema:
            lc = getattr(schema, 'list_config', None)
            if lc is not None:
                return lc.page_size or None
        return self.paginate_by

    def get_queryset(self):
        from django.core.exceptions import FieldError
        from django.db.models import Q as DQ

        qs     = super().get_queryset()
        schema = self._get_schema()
        if schema is None:
            return qs

        columns = normalize_columns(getattr(schema, 'columns', []))

        # ── Busca ─────────────────────────────────────────────────────────────
        q = self.request.GET.get('q', '').strip()
        if q:
            combined = DQ()
            for col in columns:
                if col.search_fields == []:
                    continue
                fields = col.search_fields if col.search_fields else [col.field]
                for sf in fields:
                    combined |= DQ(**{f'{sf}__icontains': q})
            try:
                qs = qs.filter(combined)
            except FieldError:
                pass

        # ── Ordenação ─────────────────────────────────────────────────────────
        sort  = self.request.GET.get('sort', '')
        order = self.request.GET.get('order', 'asc')
        if sort:
            sortable = {col.field for col in columns if col.sortable}
            if sort in sortable:
                qs = qs.order_by(f'{"-" if order == "desc" else ""}{sort}')

        return qs

    def get(self, request, *args, **kwargs):
        if request.GET.get('format') == 'csv':
            return self._export_csv()
        return super().get(request, *args, **kwargs)

    def _export_csv(self):
        import csv

        schema  = self._get_schema()
        columns = normalize_columns(getattr(schema, 'columns', [])) if schema else []

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = (
            f'attachment; filename="{self.model._meta.model_name}.csv"'
        )
        response.write('﻿')  # BOM para Excel

        writer = csv.writer(response)

        # Cabeçalho
        headers = []
        for col in columns:
            if col.label:
                headers.append(col.label)
            else:
                try:
                    headers.append(
                        self.model._meta.get_field(col.field.split('__')[0]).verbose_name.capitalize()
                    )
                except Exception:
                    headers.append(col.field)
        writer.writerow(headers)

        # Dados
        for obj in self.get_queryset():
            row = []
            for col in columns:
                val = resolve_attr(obj, col.field)
                if hasattr(val, 'label'):   # Badge / Link
                    val = val.label
                row.append(str(val) if val is not None else '')
            writer.writerow(row)

        return response

    def get_context_data(self, **kwargs):
        ctx   = super().get_context_data(**kwargs)
        q     = self.request.GET.get('q', '')
        sort  = self.request.GET.get('sort', '')
        order = self.request.GET.get('order', 'asc')

        params = self.request.GET.copy()
        params.pop('page', None)

        ctx['current_q']     = q
        ctx['current_sort']  = sort
        ctx['current_order'] = order
        ctx['query_params']  = params.urlencode()
        return ctx


class BaseCreateView(NyxBaseMixin, CreateView):
    """
    View de criação genérica.
    Template padrão: generic/form.html
    """
    _permission_action = 'add'
    template_name      = "generic/form.html"

    def get_breadcrumb_extra(self):
        verbose = self.model._meta.verbose_name.capitalize()
        return [BreadcrumbItem(label=f'Novo')]

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        back = ctx.get('back_url')
        if back:
            try:
                back = reverse(back)
            except Exception:
                back = None
        ctx['cancel_url'] = back or self.get_success_url()
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
        return [BreadcrumbItem(label=str(self.object))]

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        back = ctx.get('back_url')
        if back:
            try:
                back = reverse(back)
            except Exception:
                back = None
        ctx['cancel_url'] = back or self.get_success_url()
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
