from nyx.framework.forms import NyxModelForm
from nyx.core.models.empresa import Empresa, Filial


class EmpresaForm(NyxModelForm):
    class Meta:
        model  = Empresa
        fields = ['nome', 'cnpj_base', 'razao_social']

class FilialForm(NyxModelForm):
    class Meta:
        model  = Filial
        fields = [
            'empresa', 'nome', 'nome_fantasia', 'cnpj',
            'inscricao_estadual', 'inscricao_municipal', 'cnae',
            'atividade', 'endereco', 'bairro', 'cidade', 'uf',
            'cep', 'fone', 'fax', 'fuso_horario', 'logo', 'footer',
        ]