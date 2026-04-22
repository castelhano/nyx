"""
forms.py — Classe base de formulários do Nyx.

NyxModelForm aplica automaticamente as mensagens de validação padronizadas
(definidas em nyx.framework.messages.V) a todos os campos do form, incluindo
erros de unicidade gerados pela camada de model.

Uso:
    from nyx.framework.forms import NyxModelForm

    class EmpresaForm(NyxModelForm):
        class Meta:
            model  = Empresa
            fields = [...]
"""

from django import forms
from django.core.exceptions import ValidationError

from nyx.framework.messages import V

# Mapa chave-de-erro → mensagem padronizada.
# Apenas chaves presentes no field.error_messages são sobrescritas.
_FIELD_MESSAGES = {
    'required':       V.required,
    'max_length':     V.max_length,
    'min_length':     V.min_length,
    'invalid':        V.invalid,
    'invalid_choice': V.invalid_choice,
    'max_value':      V.max_value,
    'min_value':      V.min_value,
}


class NyxModelForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._apply_error_messages()
        self._apply_widget_attrs()

    def _apply_error_messages(self):
        for field in self.fields.values():
            for key, msg in _FIELD_MESSAGES.items():
                if key in field.error_messages:
                    field.error_messages[key] = msg

    def _apply_widget_attrs(self):
        has_placeholder = hasattr(self.instance, 'get_placeholder')
        has_mask        = hasattr(self.instance, 'get_mask')
        first           = True
        for name, field in self.fields.items():
            attrs = field.widget.attrs
            if first and field.widget.is_hidden is False:
                attrs.setdefault('autofocus', True)
                first = False
            if has_placeholder:
                placeholder = self.instance.get_placeholder(name)
                if placeholder:
                    attrs.setdefault('placeholder', placeholder)
            if field.help_text:
                attrs.setdefault('title', str(field.help_text))
            if has_mask:
                mask = self.instance.get_mask(name)
                if mask:
                    attrs.setdefault('data-mask', mask)

    def validate_unique(self):
        """Intercepta erros de unicidade e aplica mensagens padronizadas."""
        exclude = self._get_validation_exclusions()
        try:
            self.instance.validate_unique(exclude=exclude)
        except ValidationError as exc:
            if not hasattr(exc, 'error_dict'):
                self._update_errors(exc)
                return
            remapped = {
                field: [
                    ValidationError(
                        V.unique_together if err.code == 'unique_together' else V.unique,
                        code=err.code,
                    ) if err.code in ('unique', 'unique_together') else err
                    for err in errors
                ]
                for field, errors in exc.error_dict.items()
            }
            self._update_errors(ValidationError(remapped))
