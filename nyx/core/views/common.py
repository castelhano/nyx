"""common.py — Views CRUD padrão de Empresa e Filial."""
from nyx.framework.views import BaseListView, BaseCreateView, BaseUpdateView, BaseDeleteView
from nyx.core.models.empresa import Empresa, Filial
from nyx.core.forms import EmpresaForm, FilialForm


# =============================================================================
# DEV
# =============================================================================

from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView

class ShowcaseView(LoginRequiredMixin, TemplateView):
    template_name = "dev/showcase.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['base_template'] = 'layout/fragment.html' if self.request.htmx else 'layout/base.html'
        return ctx


# =============================================================================
# EMPRESA
# =============================================================================

class EmpresaListView(BaseListView):
    model = Empresa

class EmpresaCreateView(BaseCreateView):
    model      = Empresa
    form_class = EmpresaForm

class EmpresaUpdateView(BaseUpdateView):
    model      = Empresa
    form_class = EmpresaForm

class EmpresaDeleteView(BaseDeleteView):
    model = Empresa

# -----

class FilialListView(BaseListView):
    model = Filial

class FilialCreateView(BaseCreateView):
    model      = Filial
    form_class = FilialForm

class FilialUpdateView(BaseUpdateView):
    model      = Filial
    form_class = FilialForm

class FilialDeleteView(BaseDeleteView):
    model = Filial