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

// Map backend error codes (emitted by AllExceptionsFilter) to user-facing messages.
// Value can be a string or a function that receives the affected fields array.
// Add or override entries here to customize any API error message.
export const apiErrorMessages: Record<string, string | ((fields: string[]) => string)> = {
  UNIQUE_VIOLATION:      (fields) => fields.length
    ? `Valor informado deve ser único: ${fields.join(', ')}`
    : 'Valor informado deve ser único',
  FOREIGN_KEY_VIOLATION: 'Registro vinculado a outros dados e não pode ser removido',
  RELATION_VIOLATION:    'Operação inválida: violação de relacionamento entre registros',
  NOT_FOUND:             'Registro não encontrado',
}
