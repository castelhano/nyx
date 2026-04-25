from django.apps import AppConfig


class DocsConfig(AppConfig):
    name = "nyx.docs"
    verbose_name = "Docs"

    def ready(self):
        from .index import build_index
        build_index()
