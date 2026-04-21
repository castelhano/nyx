# Guia: Criar uma View CRUD

> Ver `docs/ARCHITECTURE.md` seções 4.1, 5 e 6 para convenções completas.

## Checklist

- [ ] View herda de `BaseListView`, `BaseCreateView`, `BaseUpdateView` ou `BaseDeleteView`
- [ ] Model declarado na view
- [ ] URL registrada via `generate_urls()` no `urls.py` do app
- [ ] Classe UI em `app/ui/modelo.py` (opcional — sem ela a view funciona sem UI declarativa)

## Mínimo funcional

```python
# views.py
class EmpresaListView(BaseListView):
    model = Empresa

# urls.py
urlpatterns = generate_urls('nyx.core', common=['Empresa'])
app_name = 'core'
```

## Respostas declarativas (NyxResponse)

Para retornar toast ou feedback de campo no fragmento HTMX:

```python
# Em form_valid, em vez de messages.success:
# O template retornado deve conter:
# <template data-response="toast" data-status="success">Salvo.</template>
```
