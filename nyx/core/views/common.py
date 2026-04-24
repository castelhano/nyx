from nyx.framework.views import BaseListView, BaseCreateView, BaseUpdateView, BaseDeleteView
from nyx.core.models.empresa import Empresa, Filial
from nyx.core.forms import EmpresaForm, FilialForm


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