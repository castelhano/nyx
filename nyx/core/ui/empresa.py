from nyx.framework.ui import Action, Column, Field, Keybind, Section


class EmpresaUI:
    icon = 'bi-building'
    title = 'Fooo'

    # ── List ─────────────────────────────────────────────────────────
    columns = [
        'nome',
        Column('cnpj_base', label='CNPJ', breakpoint='sm'),
        Column('razao_social', label='Razão Social', breakpoint='lg'),
    ]

    toolbar = [
        Action(keybind=Keybind(keys='alt+n')),
    ]

    row_actions = [
        Action(url_name='core:empresa_update', icon='bi-pencil'),
    ]

    # ── Form ─────────────────────────────────────────────────────────
    sections = [
        Section('Dados gerais', fields=[
            Field('nome', col_span=8),
            Field('cnpj_base', label='CNPJ', col_span=4),
            Field('razao_social', col_span=12),
        ]),
    ]