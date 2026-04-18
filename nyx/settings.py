import dj_database_url
from pathlib import Path
from decouple import config

# =============================================================================
# CAMINHOS
# =============================================================================

BASE_DIR = Path(__file__).resolve().parent.parent

# =============================================================================
# SEGURANÇA
# =============================================================================

SECRET_KEY = config('SECRET_KEY')
DEBUG       = config('DEBUG', cast=bool, default=False)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost',
                       cast=lambda v: [h.strip() for h in v.split(',')])

# =============================================================================
# APPS
# =============================================================================

INSTALLED_APPS = [
    # Core
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Terceiros
    'django_htmx',
    'django_cotton',
    # Nyx
    'nyx.framework',
    'nyx.core',
    # 'nyx.framework',
    # 'nyx.operacao',
]

# =============================================================================
# MIDDLEWARE
# =============================================================================

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django_htmx.middleware.HtmxMiddleware',                    # disponibiliza request.htmx nas views
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# =============================================================================
# DEBUG TOOLBAR (apenas em desenvolvimento)
# =============================================================================

if DEBUG:
    INSTALLED_APPS += ['debug_toolbar', 'django_extensions']
    MIDDLEWARE.insert(0, 'debug_toolbar.middleware.DebugToolbarMiddleware')
    INTERNAL_IPS = ['127.0.0.1']

# =============================================================================
# URLS / WSGI
# =============================================================================

ROOT_URLCONF      = 'nyx.urls'
WSGI_APPLICATION  = 'nyx.wsgi.application'

# =============================================================================
# TEMPLATES
# =============================================================================

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'nyx' / 'templates'],
        # APP_DIRS=False quando DIRS é usado com loaders explícitos
        # (necessário para o django-cotton funcionar junto com APP_DIRS)
        'APP_DIRS': False,
        'OPTIONS': {
            'loaders': [
                'django_cotton.cotton_loader.Loader',           # Cotton ANTES do loader padrão
                'django.template.loaders.filesystem.Loader',
                'django.template.loaders.app_directories.Loader',
            ],
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'nyx.framework.context_processors.nyx_nav',
            ],
            'builtins': [
                # Carrega nyx_ui automaticamente em todos os templates
                # (remove necessidade de {% load nyx_ui %} em cada template)
                'nyx.framework.templatetags.nyx_ui',
            ],
        },
    },
]

# =============================================================================
# BANCO DE DADOS
# =============================================================================

DATABASES = {
    'default': dj_database_url.parse(config('DATABASE_URL'))
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# =============================================================================
# AUTENTICAÇÃO
# =============================================================================

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LOGIN_URL          = 'login'       # nome da url de login
LOGIN_REDIRECT_URL = '/'           # redireciona após login bem-sucedido
LOGOUT_REDIRECT_URL = 'login'      # redireciona após logout

# =============================================================================
# INTERNACIONALIZAÇÃO
# =============================================================================

LANGUAGE_CODE = config('LANGUAGE_CODE', default='pt-br')
TIME_ZONE     = config('TIME_ZONE', default='America/Cuiaba')
USE_I18N      = True
USE_TZ        = True

# =============================================================================
# ARQUIVOS ESTÁTICOS
# =============================================================================

STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'nyx' / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'

# =============================================================================
# ARQUIVOS DE MÍDIA (uploads dos usuários)
# =============================================================================

MEDIA_URL  = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'