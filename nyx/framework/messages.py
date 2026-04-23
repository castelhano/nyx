"""
messages.py — Mensagens padrão do sistema Nyx.

Uso:
    from nyx.framework import messages as nyx_msg
    from django.contrib import messages

    messages.success(request, nyx_msg.CREATED.format(model='Empresa'))
    messages.error(request, nyx_msg.RECORD_LOCKED)

    # Mensagens de validação (aplicadas automaticamente via NyxModelForm):
    nyx_msg.V.required   →  "Este campo é obrigatório"
    nyx_msg.V.unique     →  "Já existe um registro com este valor"
"""

# — CRUD —
CREATED    = "Registro criado com sucesso"
UPDATED    = "Registro atualizado com sucesso"
DELETED    = "Registro excluído"
FORM_ERROR = "Verifique os campos destacados"

# — Validação de datas —
DATE_END_BEFORE_START = "A data final não pode ser anterior à data inicial"

# — Estado / fluxo —
RECORD_LOCKED   = "Este registro está bloqueado e não pode ser movimentado"
RECORD_INACTIVE = "Não é possível operar sobre um registro inativo"


class V:
    """
    Mensagens de validação de campos de formulário.
    Aplicadas automaticamente em todos os forms que herdam de NyxModelForm.

    Uso explícito (validações customizadas):
        from nyx.framework.messages import V
        raise ValidationError(V.unique)
        raise ValidationError(V.max_length % {'limit_value': 50})
    """
    # obrigatoriedade
    required        = "Campo obrigatório"

    # tamanho / valor
    max_length      = "Máximo de %(limit_value)s caracteres"
    min_length      = "Mínimo de %(limit_value)s caracteres"
    max_value       = "Valor máximo permitido: %(limit_value)s"
    min_value       = "Valor mínimo permitido: %(limit_value)s"

    # formato
    invalid         = "Valor inválido"
    invalid_choice  = "Selecione uma opção válida"
    invalid_date    = "Informe uma data válida"
    invalid_number  = "Informe um número válido"
    invalid_email   = "Informe um endereço de e-mail válido"
    invalid_url     = "Informe uma URL válida"

    # unicidade
    unique          = "Já existe um registro com este valor"
    unique_together = "Esta combinação já está cadastrada"
