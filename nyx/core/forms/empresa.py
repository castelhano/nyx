from nyx.framework.forms import NyxModelForm
from nyx.core.models.empresa import Empresa


class EmpresaForm(NyxModelForm):
    class Meta:
        model  = Empresa
        fields = ['nome', 'cnpj_base', 'razao_social']
