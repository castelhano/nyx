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


handler403 = 'nyx.core.views.errors.error_403'
handler404 = 'nyx.core.views.errors.error_404'
handler500 = 'nyx.core.views.errors.error_500'

urlpatterns = [
    path('', include('nyx.core.urls')),
    path('docs/', include('nyx.docs.urls')),
    path('login/', _LoginView.as_view(), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    # path('operacao/', include('nyx.operacao.urls')),
]

if settings.DEBUG:
    from debug_toolbar.toolbar import debug_toolbar_urls
    from nyx.core.views.errors import error_403, error_404, error_500
    urlpatterns += debug_toolbar_urls()
    urlpatterns += [
        path('errors/403/', error_403, name='preview_403'),
        path('errors/404/', error_404, name='preview_404'),
        path('errors/500/', error_500, name='preview_500'),
    ]