"""dashboard.py — Views do painel principal."""
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView


class DashboardIndexView(LoginRequiredMixin, TemplateView):
    """Página inicial do sistema. Exige autenticação."""
    template_name = "core/index.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['base_template'] = 'layout/fragment.html' if getattr(self.request, 'htmx', False) else 'layout/base.html'
        return ctx