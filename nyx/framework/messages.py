"""
messages.py — Mensagens padrão do sistema Nyx.

Uso:
    from nyx.framework import messages as nyx_msg
    from django.contrib import messages

    messages.success(request, nyx_msg.CREATED.format(model='Empresa'))
    messages.error(request, nyx_msg.RECORD_LOCKED)
"""

# — CRUD —
CREATED    = "{model} criado com sucesso"
UPDATED    = "{model} atualizado com sucesso"
DELETED    = "{model} excluído"
FORM_ERROR = "Verifique os campos destacados"

# — Validação de datas —
DATE_END_BEFORE_START = "A data final não pode ser anterior à data inicial"

# — Estado / fluxo —
RECORD_LOCKED   = "Este registro está bloqueado e não pode ser movimentado"
RECORD_INACTIVE = "Não é possível operar sobre um registro inativo"
