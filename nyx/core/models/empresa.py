"""
empresa.py — Models de Empresa e derivados diretos
"""
import os
from django.db import models
from django.utils.translation import gettext_lazy as _
from nyx.framework.utils import get_timezone_choices


class Empresa(models.Model):
    nome = models.CharField(_('Nome'), max_length=50, unique=True, blank=False)
    cnpj_base = models.CharField(_('Cnpj Base'), max_length=20, blank=True)
    razao_social = models.CharField(_('Razão Social'), max_length=150, blank=True)
    class Meta:
        verbose_name        = "Empresa"
        verbose_name_plural = "Empresas"
        ordering            = ["nome"]
    def __str__(self):
        return self.nome


class Filial(models.Model):
    empresa = models.ForeignKey(Empresa, on_delete=models.PROTECT, related_name='filiais', verbose_name=_('Empresa'))
    nome = models.CharField(_('Nome'), max_length=50, unique=True, blank=False)
    nome_fantasia = models.CharField(_('Nome Fantasia'), max_length=150, blank=True)
    cnpj = models.CharField(_('Cnpj'), max_length=20, blank=True)
    inscricao_estadual = models.CharField(_('Inscrição Estadual'), max_length=25, blank=True)
    inscricao_municipal = models.CharField(_('Inscrição Municipal'), max_length=25, blank=True)
    cnae = models.CharField(_('Cnae'), max_length=20, blank=True)
    atividade = models.CharField(_('Atividade'), max_length=255, blank=True)
    endereco = models.CharField(_('Endereço'), max_length=255, blank=True)
    bairro = models.CharField(_('Bairro'), max_length=100, blank=True)
    cidade = models.CharField(_('Cidade'), max_length=60, blank=True)
    uf = models.CharField(_('Uf'), max_length=5, blank=True)
    cep = models.CharField(_('Cep'), max_length=10, blank=True)
    fone = models.CharField(_('Fone'), max_length=20, blank=True)
    fax = models.CharField(_('Fax'), max_length=20, blank=True)
    fuso_horario = models.CharField(_('Fuso Horário'), blank=True, max_length=50, choices=get_timezone_choices)
    logo = models.ImageField(_('Logo'), upload_to="core/logos/", blank=True)
    footer = models.TextField(_('Rodapé'), blank=True)
    class Meta:
        verbose_name        = "Filial"
        verbose_name_plural = "Filiais"
        ordering            = ["empresa", "nome"]
    def __str__(self):
        return self.nome
    def logo_filename(self):
        return os.path.basename(self.logo.name)
