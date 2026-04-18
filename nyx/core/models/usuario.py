"""
usuario.py — Perfil de usuário estendido.

Expande o auth.User com dados específicos do Nyx:
    - filiais: quais filiais o usuário pode acessar (vazio = acesso total)

Sinal post_save garante que todo User criado já tenha um Profile.
"""
from django.contrib.auth.models import User
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils.translation import gettext_lazy as _

from nyx.core.models.empresa import Filial


class Profile(models.Model):
    user    = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    filiais = models.ManyToManyField(Filial, blank=True, verbose_name=_('Filiais'))
    force_password_change = models.BooleanField(_('Forçar troca de senha'), default=True)
    config = models.JSONField(_('Configurações'), default=dict, blank=True, null=True)
    class Meta:
        verbose_name        = "Profile"
        verbose_name_plural = "Perfis"
    def __str__(self):
        return f"Profile de {self.user.username}"


@receiver(post_save, sender=User)
def criar_profile(sender, instance, created, **kwargs):
    """Cria automaticamente um Profile para cada novo usuário."""
    if created:
        Profile.objects.create(user=instance)
