from django.views.generic import TemplateView
from django.contrib.auth.mixins import LoginRequiredMixin


class DashboardIndexView(TemplateView):
    template_name = "core/index.html"