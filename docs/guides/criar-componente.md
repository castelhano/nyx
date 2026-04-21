# Guia: Criar um Componente UI

> Checklist para garantir que todo componente segue a arquitetura Nyx.
> Ver `docs/ARCHITECTURE.md` seção 8 para contexto.

## Checklist

- [ ] `nyx/static/js/components/nome.js` — `NyxDom.register('nome-kebab', ...)`
- [ ] `nyx/static/css/components.css` — bloco `.nome {}` com comentário de estrutura HTML
- [ ] `nyx/templates/cotton/nome.html` — com `<c-vars>` declarando todos os defaults
- [ ] `nyx/templates/layout/base.html` — adicionar `<script src="...components/nome.js">`
- [ ] `docs/components/nome.md` — documentar props, slots, data-attrs e exemplos

## Regras

- destroyFn obrigatória se houver listeners em `document` ou `window`
- Cancelar timers na destroyFn
- Usar `data-keybind-group` se o componente registrar atalhos
