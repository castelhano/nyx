from nyx.framework.forms import NyxModelForm
from nyx.core.models.empresa import Filial


class FilialForm(NyxModelForm):
    class Meta:
        model  = Filial
        fields = [
            'empresa', 'nome', 'nome_fantasia', 'cnpj',
            'inscricao_estadual', 'inscricao_municipal', 'cnae',
            'atividade', 'endereco', 'bairro', 'cidade', 'uf',
            'cep', 'fone', 'fax', 'fuso_horario', 'footer',
        ]
