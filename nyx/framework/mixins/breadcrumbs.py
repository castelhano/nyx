"""
breadcrumbs.py — Mixin para geracao automatica de breadcrumbs.

Constroi o breadcrumb a partir do que a view ja declara (model, ui_schema)
e do registry de navegacao (framework/registry.py), que contem a hierarquia
completa inferida pelas ForeignKeys.

COMPORTAMENTO AUTOMATICO:
    Dado um model registrado, o mixin sobe recursivamente pela hierarquia
    de parents ate a raiz e constroi o caminho completo.

    Ex: DependenteListView com model=Dependente
        Dependente -> parent: Funcionario -> parent: None (raiz do app)

        Resultado: Inicio > Pessoal > Funcionarios > Dependentes

NIVEIS DINAMICOS (objeto especifico):
    Quando a pagina exibe um objeto especifico (ex: "Joao Silva"),
    sobrescreva get_breadcrumb_extra() na view:

        class AfastamentoListView(BaseListView):
            def get_breadcrumb_extra(self):
                func = Funcionario.objects.get(pk=self.kwargs['funcionario_pk'])
                return [BreadcrumbItem(str(func), 'pessoal:funcionario_update', func.pk)]

CASO COMPLETAMENTE FORA DO PADRAO:
    Sobrescreva get_breadcrumbs() inteiro:

        class RelatorioView(BaseListView):
            def get_breadcrumbs(self):
                return [
                    BreadcrumbItem('Inicio', 'core:index'),
                    BreadcrumbItem('Relatorios', None),
                ]
"""

from dataclasses import dataclass, field


# =============================================================================
# ESTRUTURA DE ITEM
# =============================================================================

@dataclass
class BreadcrumbItem:
    """
    Representa um nivel do breadcrumb.

    Atributos:
        label   — texto exibido
        url     — nome da URL (ex: 'pessoal:funcionario_list') ou None para item atual
        pk      — pk do objeto para URLs que precisam de argumento (ex: update)
        actions — lista de NavAction para dropdown neste nivel (preenchido pelo mixin)
    """
    label:   str
    url:     str | None = None
    pk:      int | None = None
    actions: list       = field(default_factory=list)


# =============================================================================
# MIXIN
# =============================================================================

class BreadcrumbMixin:
    """
    Adiciona breadcrumb automatico ao contexto de qualquer view.

    Ja incluido em NyxBaseMixin (framework/views.py).
    Na grande maioria dos casos nao e necessario nenhuma configuracao.
    """

    def get_breadcrumbs(self) -> list[BreadcrumbItem]:
        """
        Constroi o breadcrumb completo para esta view.

        Sobrescreva apenas para casos completamente fora do padrao.
        Para adicionar niveis apos o automatico, use get_breadcrumb_extra().
        """
        from nyx.framework.registry import get_nav
        from django.views.generic.list import MultipleObjectMixin

        crumbs = [BreadcrumbItem('Inicio', 'core:index')]

        if not hasattr(self, 'model') or self.model is None:
            return crumbs + self.get_breadcrumb_extra()

        nav = get_nav(self.model)

        # Sobe na hierarquia de parents recursivamente
        ancestors = self._resolve_ancestors(self.model)

        for ancestor in ancestors:
            anc_nav = get_nav(ancestor)
            if not anc_nav:
                continue
            label = str(ancestor._meta.verbose_name_plural).capitalize()
            crumbs.append(BreadcrumbItem(
                label   = label,
                url     = anc_nav.list_url,
                actions = anc_nav.actions,
            ))

        # Nivel atual — se for listagem nao tem link, se for form/detalhe tem
        if nav:
            label = ''
            if hasattr(self, 'ui_schema') and self.ui_schema:
                label = getattr(self.ui_schema, 'title', '')
            if not label:
                label = str(self.model._meta.verbose_name_plural).capitalize()

            is_list = isinstance(self, MultipleObjectMixin)
            crumbs.append(BreadcrumbItem(
                label   = label,
                url     = None if is_list else nav.list_url,
                actions = nav.actions if not is_list else [],
            ))

        # Niveis extras declarados na view (objeto especifico, sub-nivel dinamico)
        crumbs += self.get_breadcrumb_extra()

        return crumbs

    def get_breadcrumb_extra(self) -> list[BreadcrumbItem]:
        """
        Sobrescreva para adicionar niveis apos o breadcrumb automatico.

        Uso mais comum: exibir o objeto especifico em views de detalhe/edicao
        ou o objeto pai em views de sub-relacao.

        Exemplo:
            def get_breadcrumb_extra(self):
                func = Funcionario.objects.get(pk=self.kwargs['funcionario_pk'])
                return [BreadcrumbItem(str(func), 'pessoal:funcionario_update', func.pk)]
        """
        return []

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['breadcrumbs'] = self.get_breadcrumbs()
        return ctx

    # -------------------------------------------------------------------------

    def _resolve_ancestors(self, model, result=None) -> list:
        """
        Sobe recursivamente pela hierarquia de parents e retorna
        a lista ordenada do mais antigo para o mais recente.

        Ex: Dependente -> Funcionario -> None
            retorna: [Funcionario]  (Dependente em si nao entra — e o nivel atual)
        """
        from nyx.framework.registry import get_nav

        if result is None:
            result = []

        nav = get_nav(model)
        if not nav or not nav.parent:
            return result

        # Sobe antes de adicionar (garante ordem raiz -> folha)
        self._resolve_ancestors(nav.parent, result)
        result.append(nav.parent)
        return result