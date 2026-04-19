from nyx.framework.views import BaseListView, BaseCreateView, BaseUpdateView, BaseDeleteView
from nyx.core.models.empresa import Empresa


class EmpresaListView(BaseListView):
    model = Empresa


class EmpresaCreateView(BaseCreateView):
    model  = Empresa
    fields = ['nome', 'cnpj_base', 'razao_social']


class EmpresaUpdateView(BaseUpdateView):
    model  = Empresa
    fields = ['nome', 'cnpj_base', 'razao_social']


class EmpresaDeleteView(BaseDeleteView):
    model = Empresa