"""
apps.py — Configuracao do app framework.

ready() apos todos os apps estarem carregados, registry de
navegacao e resolvido (flush), transformando as intencoes enfileiradas
pelo generate_urls() em NavEntries completas com parents e actions
inferidos automaticamente pelas ForeignKeys dos models.
"""

from django.apps import apps
from nyx.framework import registry
from django.apps import AppConfig


class FrameworkConfig(AppConfig):
    name         = 'nyx.framework'
    verbose_name = 'Framework'
    def ready(self):
        """
        Ponto de entrada apos todos os apps Django estarem carregados.

        Forca a importacao dos urls.py de todos os apps nyx.* via importlib
        para garantir que os _queue() do generate_urls() foram executados
        antes do _flush(). Sem isso o _pending estaria vazio no momento
        do flush, pois os urls.py so seriam importados na primeira requisicao.
        """
        for app_config in apps.get_app_configs():
            if app_config.name.startswith('nyx.'):
                try:
                    import importlib
                    importlib.import_module(f'{app_config.name}.urls')
                except ImportError:
                    pass

        registry._flush()