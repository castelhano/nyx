"""
scoping.py — Filtro automático de queryset por filial do usuário.

Adicione FilialScopeMixin nas views que precisam de escopo multi-filial.
Já está incluso em NyxBaseMixin (framework/views.py), então na maioria
dos casos você não precisa adicioná-lo manualmente.

Personalizações por view:
    filial_field = "filial"        # nome do campo FK para Filial no model
    filial_field = "empresa__filial"  # suporta lookup com __ para relacionamentos

Usuários sem filiais restritas (campo vazio) enxergam todos os registros.
Isso equivale a um "superusuário de empresa" — útil para admins internos.
"""

from django.db.models import QuerySet


class FilialScopeMixin:
    """
    Filtra automaticamente o queryset pelas filiais vinculadas ao usuário.

    Depende de:
        - request.user.perfil.filiais  (ManyToManyField para core.Filial)
        - self.filial_field            (nome do campo no model, default: "filial")
    """

    filial_field: str = "filial"

    def get_queryset(self) -> QuerySet:
        qs = super().get_queryset()

        try:
            filiais = self.request.user.perfil.filiais.all()
        except AttributeError:
            # Perfil não configurado — não aplica filtro (seguro para setup inicial)
            return qs

        if filiais.exists():
            return qs.filter(**{f"{self.filial_field}__in": filiais})

        # Sem filiais restritas → acesso total
        return qs
