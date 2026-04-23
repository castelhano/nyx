from nyx.framework.ui import Column, Field, Section


class EmpresaUI:
    icon = 'bi bi-building'

    # ── List ─────────────────────────────────────────────────────────
    columns = [
        'nome',
        Column('cnpj_base', label='CNPJ', breakpoint='sm'),
        Column('razao_social', label='Razão Social', breakpoint='lg'),
    ]

    # ── Form ─────────────────────────────────────────────────────────
    sections = [
        Section('Geral', fields=[
            Field('nome', col_span=8),
            Field('cnpj_base', label='CNPJ', col_span=4),
            Field('razao_social', col_span=12),
        ]),
    ]