from django.urls import path, include
from django.conf import settings
from django.contrib.auth import views as auth_views


class _LoginView(auth_views.LoginView):
    """LoginView com suporte a remember_me: sem o campo, a sessão expira ao fechar o navegador."""
    template_name = 'registration/login.html'

    def form_valid(self, form):
        response = super().form_valid(form)
        if not self.request.POST.get('remember_me'):
            self.request.session.set_expiry(0)
        return response


urlpatterns = [
    path('', include('nyx.core.urls')),
    path('login/', _LoginView.as_view(), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    # path('operacao/', include('nyx.operacao.urls')),
]

if settings.DEBUG:
    from debug_toolbar.toolbar import debug_toolbar_urls
    urlpatterns += debug_toolbar_urls()