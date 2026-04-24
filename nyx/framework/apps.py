"""
apps.py — Configuracao do app framework.

O registry de navegacao usa flush lazy: _flush() e disparado automaticamente
na primeira chamada a get_nav() ou get_all(), momento em que o Django ja
importou todos os urls.py (para resolver a requisicao), garantindo que
_pending esteja populado. Nao e necessario flush eagerly no ready().
"""

from django.apps import AppConfig


class FrameworkConfig(AppConfig):
    name         = 'nyx.framework'
    verbose_name = 'Framework'