"""validators.py — Validador de senhas dinâmico baseado em PasswordPolicy."""
import string
from functools import lru_cache

from django.contrib.auth.hashers import check_password
from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _


@lru_cache(maxsize=1)
def _get_policy():
    from nyx.core.models.policy import PasswordPolicy
    return PasswordPolicy.objects.first()


class DynamicPasswordValidator:

    def validate(self, password, user=None):
        policy = _get_policy()
        if not policy:
            return

        errors = []

        if len(password) < policy.min_length:
            errors.append(ValidationError(
                _('A senha deve ter no mínimo %(min)d caracteres.'),
                code='password_too_short',
                params={'min': policy.min_length},
            ))

        if policy.require_alpha and not any(c.isalpha() for c in password):
            errors.append(ValidationError(
                _('A senha deve conter pelo menos uma letra.'),
                code='password_no_alpha',
            ))

        if policy.require_uppercase and not any(c.isupper() for c in password):
            errors.append(ValidationError(
                _('A senha deve conter pelo menos uma letra maiúscula.'),
                code='password_no_upper',
            ))

        if policy.require_digits and not any(c.isdigit() for c in password):
            errors.append(ValidationError(
                _('A senha deve conter pelo menos um número.'),
                code='password_no_digit',
            ))

        if policy.require_symbols and not any(c in string.punctuation for c in password):
            errors.append(ValidationError(
                _('A senha deve conter pelo menos um caractere especial.'),
                code='password_no_symbol',
            ))

        if user is not None and policy.reuse_limit > 0:
            try:
                history = (user.profile.config or {}).get('password_history', [])
                for encoded in history[:policy.reuse_limit]:
                    if check_password(password, encoded):
                        errors.append(ValidationError(
                            _('Esta senha já foi usada recentemente. Escolha uma senha diferente.'),
                            code='password_reused',
                        ))
                        break
            except Exception:
                pass

        if errors:
            raise ValidationError(errors)

    def get_help_text(self):
        policy = _get_policy()
        if not policy:
            return ''
        hints = []
        if policy.min_length:
            hints.append(f'mínimo {policy.min_length} caracteres')
        if policy.require_alpha:
            hints.append('pelo menos uma letra')
        if policy.require_uppercase:
            hints.append('pelo menos uma maiúscula')
        if policy.require_digits:
            hints.append('pelo menos um número')
        if policy.require_symbols:
            hints.append('pelo menos um caractere especial')
        return ('Sua senha precisa ter: ' + ', '.join(hints) + '.') if hints else ''
