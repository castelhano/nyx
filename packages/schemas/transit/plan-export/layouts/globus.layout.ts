import type { ExportLayoutDef } from '../plan-export.types'

// Globus "importação de programação" — fixed-width TXT, 62 chars per line, CRLF. Same layout
// as the legacy flow/oso_export script's settings.layout.
export const GLOBUS_LAYOUT_DEF: ExportLayoutDef = {
  layout: [
    { field: 'COD_PROGRAMAÇÃO', label: 'Programação', size: 8, pad: ' ', align: 'L', level: 'program', required: true },
    { field: 'SERVICO_TAB',     label: 'Tabela',      size: 5, pad: ' ', align: 'L', level: 'table',   required: true, editable: true, pattern: '[0-9A-Za-z]+', uniqueInProgram: true },
    { field: 'TURNO',           label: 'Período',     size: 1, pad: ' ', align: 'L', level: 'table',   required: true, editable: true, pattern: '[0-9]' },
    { field: 'INICIO_SERVICO',  label: 'Início',      size: 5, pad: ' ', align: 'L', level: 'table',   mask: 'HH:MM' },
    { field: 'FIM_SERVICO',     label: 'Fim',         size: 5, pad: ' ', align: 'L', level: 'table',   mask: 'HH:MM' },
    { field: 'COD_LOCAL_MOT',   label: 'Pegada',      size: 6, pad: '0', align: 'R', level: 'table' },
    { field: 'PREPARO_MOT',     label: 'Preparo',     size: 2, pad: '0', align: 'R', level: 'table' },
    { field: 'SAIDA_GAR',       label: 'Saída gar.',  size: 5, pad: ' ', align: 'L', level: 'table',   mask: 'HH:MM' },
    { field: 'SENTIDO',         label: 'Sentido',     size: 1, pad: ' ', align: 'L', level: 'row' },
    { field: 'COD_VIAGENS',     label: 'Seq',         size: 2, pad: '0', align: 'R', level: 'row' },
    { field: 'HORARIO_SAIDA',   label: 'Saída',       size: 5, pad: ' ', align: 'L', level: 'row',     mask: 'HH:MM' },
    { field: 'HORARIO_CHEGADA', label: 'Chegada',     size: 5, pad: ' ', align: 'L', level: 'row',     mask: 'HH:MM' },
    { field: 'COD_ATIVIDADE',   label: 'Atividade',   size: 2, pad: '0', align: 'R', level: 'row',     required: true, editable: true },
    { field: 'COD_LOCALIDADE',  label: 'Local',       size: 6, pad: '0', align: 'R', level: 'row',     editable: true },
    { field: 'COD_LINHA',       label: 'Linha',       size: 4, pad: ' ', align: 'R', level: 'row',     editable: true },
  ],
  availableFields: [
    'COD_PROGRAMAÇÃO', 'SERVICO_TAB', 'TURNO', 'INICIO_SERVICO', 'FIM_SERVICO', 'COD_LOCAL_MOT',
    'COD_LOCAL_COB', 'PREPARO_MOT', 'PREPARO_COB', 'RETORNO_GAR', 'ENTREGA_FERIAS', 'SAIDA_GAR',
    'SENTIDO', 'COD_VIAGENS', 'HORARIO_SAIDA', 'HORARIO_CHEGADA', 'COD_ATIVIDADE', 'COD_LOCALIDADE',
    'COD_LINHA', 'DURACAO_ATIVIDADE', 'SUFIXO', 'TIPO_HORARIO', 'DUPLA_PEGADA', 'IDENTIFICADOR',
    'SERV_RENDICAO',
  ],
  notice: 'A programação precisa existir no Globus antes da importação.',
}
