export const msgs = {
  created: (label = 'Registro') => `${label} criado com sucesso`,
  updated: (label = 'Registro') => `${label} atualizado com sucesso`,
  deleted: (label = 'Registro') => `${label} excluído com sucesso`,
  saved:   (label = 'Registro') => `${label} salvo com sucesso`,
  error: {
    save:   () => 'Erro ao salvar. Tente novamente.',
    delete: () => 'Erro ao excluir. Tente novamente.',
    load:   () => 'Erro ao carregar dados.',
  },
}
