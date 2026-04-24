from nyx.framework.ui import Column, Field, Section, Keybind


class EmpresaUI:
    icon = 'bi bi-buildings-fill'

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

class FilialUI:
    icon = 'bi bi-building-fill-gear'

    # ── List ─────────────────────────────────────────────────────────
    columns = [
        'nome',
        Column('empresa',  label='Empresa',  breakpoint='sm'),
        Column('cnpj',     label='CNPJ',     breakpoint='sm'),
        Column('cidade',   label='Cidade',   breakpoint='lg'),
    ]

    # ── Form ─────────────────────────────────────────────────────────
    sections = [
        Section('Geral', fields=[
            Field('empresa',             col_span=12),
            Field('nome',                col_span=6),
            Field('nome_fantasia',       col_span=6),
            Field('cnpj',                col_span=4),
            Field('inscricao_estadual',  col_span=4),
            Field('inscricao_municipal', col_span=4),
            Field('cnae',                col_span=4),
            Field('atividade',           col_span=8),
        ]),
        Section('Endereço', fields=[
            Field('endereco', col_span=8),
            Field('bairro',   col_span=4),
            Field('cidade',   col_span=6),
            Field('uf',       col_span=2),
            Field('cep',      col_span=4),
        ]),
        Section('Contato & Config', fields=[
            Field('fone',        col_span=4),
            Field('fax',         col_span=4),
            Field('fuso_horario', col_span=4),
            Field('footer',      col_span=12),
        ]),
    ]