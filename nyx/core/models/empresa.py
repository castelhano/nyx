"""
empresa.py — Models de Empresa e derivados diretos
"""
import os
from django.db import models
from django.utils.translation import gettext_lazy as _
from nyx.framework.utils import get_timezone_choices


class Empresa(models.Model):
    nome         = models.CharField(_('Nome'), max_length=50, unique=True, blank=False)
    cnpj_base    = models.CharField(_('Cnpj Base'), max_length=20, blank=True,
                                    help_text=_('8 primeiros dígitos do CNPJ, sem filial e dígitos verificadores'))
    razao_social = models.CharField(_('Razão Social'), max_length=150, blank=True)

    class Meta:
        verbose_name        = "Empresa"
        verbose_name_plural = "Empresas"
        ordering            = ["nome"]

    def __str__(self):
        return self.nome

    def get_placeholder(self, field_name):
        return {
            'nome':         _('Nome abreviado'),
            'cnpj_base':    _('00.000.000'),
            'razao_social': _('Razão social conforme contrato social'),
        }.get(field_name, '')

    def get_mask(self, field_name):
        return {
            'cnpj_base': '00.000.000',
        }.get(field_name, '')


class Filial(models.Model):
    empresa             = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='filiais', verbose_name=_('Empresa'))
    nome                = models.CharField(_('Nome'), max_length=50, unique=True, blank=False)
    nome_fantasia       = models.CharField(_('Nome Fantasia'), max_length=150, blank=True)
    cnpj                = models.CharField(_('Cnpj'), max_length=20, blank=True)
    inscricao_estadual  = models.CharField(_('Inscrição Estadual'), max_length=25, blank=True)
    inscricao_municipal = models.CharField(_('Inscrição Municipal'), max_length=25, blank=True)
    cnae                = models.CharField(_('Cnae'), max_length=20, blank=True,
                                           help_text=_('Classificação Nacional de Atividades Econômicas'))
    atividade           = models.CharField(_('Atividade'), max_length=255, blank=True)
    endereco            = models.CharField(_('Endereço'), max_length=255, blank=True)
    bairro              = models.CharField(_('Bairro'), max_length=100, blank=True)
    cidade              = models.CharField(_('Cidade'), max_length=60, blank=True)
    uf                  = models.CharField(_('UF'), max_length=5, blank=True)
    cep                 = models.CharField(_('Cep'), max_length=10, blank=True)
    fone                = models.CharField(_('Fone'), max_length=20, blank=True)
    fax                 = models.CharField(_('Fax'), max_length=20, blank=True)
    fuso_horario        = models.CharField(_('Fuso Horário'), blank=True, max_length=50, choices=get_timezone_choices)
    logo                = models.ImageField(_('Logo'), upload_to="core/logos/", blank=True,
                                            help_text=_('Usado na geração de relatórios'))
    footer              = models.TextField(_('Rodapé'), blank=True,
                                           help_text=_('Usado na geração de relatórios'))

    class Meta:
        verbose_name        = "Filial"
        verbose_name_plural = "Filiais"
        ordering            = ["empresa", "nome"]

    def __str__(self):
        return self.nome

    def logo_filename(self):
        return os.path.basename(self.logo.name)

    def get_placeholder(self, field_name):
        return {
            'nome':                _('Nome abreviado'),
            'nome_fantasia':       _('Nome visível ao público'),
            'cnpj':                _('00.000.000/0000-00'),
            'inscricao_estadual':  _('Cadastro estadual'),
            'inscricao_municipal': _('Cadastro municipal'),
            'cnae':                _('0000-0/00'),
            'endereco':            _('Rua, número, complemento'),
            'cep':                 _('00000-000'),
            'fone':                _('(00) 00000-0000'),
            'fax':                 _('(00) 0000-0000'),
        }.get(field_name, '')

    def get_mask(self, field_name):
        return {
            'cnpj':               '00.000.000/0000-00',
            'cep':                '00000-000',
            'fone':               '(00) 00000-0000',
            'fax':                '(00) 0000-0000',
            'cnae':               '0000-0/00',
        }.get(field_name, '')
