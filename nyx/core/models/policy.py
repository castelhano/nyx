"""policy.py — Política global de senhas (singleton)."""
from django.db import models
from django.utils.translation import gettext_lazy as _


class PasswordPolicy(models.Model):
    min_length        = models.PositiveSmallIntegerField(_('Mínimo de caracteres'), default=8)
    require_alpha     = models.BooleanField(_('Exigir letra'), default=False)
    require_uppercase = models.BooleanField(_('Exigir maiúscula'), default=False)
    require_digits    = models.BooleanField(_('Exigir número'), default=False)
    require_symbols   = models.BooleanField(_('Exigir símbolo'), default=False)
    reuse_limit       = models.PositiveSmallIntegerField(
        _('Limite de reutilização'),
        default=0,
        help_text=_('Quantidade de senhas anteriores que não podem ser reutilizadas. Zero desabilita.'),
    )

    class Meta:
        verbose_name        = 'Política de senhas'
        verbose_name_plural = 'Política de senhas'

    def __str__(self):
        return 'Política de senhas'

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)
        from nyx.framework.validators import _get_policy
        _get_policy.cache_clear()

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
