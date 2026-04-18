from django.urls import path, include
from django.conf import settings
from django.contrib.auth import views as auth_views

urlpatterns = [
    path('', include('nyx.core.urls')),
    path('login/', auth_views.LoginView.as_view(template_name='registration/login.html'), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    # path('operacao/', include('nyx.operacao.urls')),
]

if settings.DEBUG:
    from debug_toolbar.toolbar import debug_toolbar_urls
    urlpatterns += debug_toolbar_urls()