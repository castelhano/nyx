export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export interface PaginationQuery {
  page?: number
  pageSize?: number
  search?: string
  sortField?: string
  sortOrder?: 'asc' | 'desc'
  [key: string]: unknown
}

export type FilterDef =
  | { type: 'text' }
  | { type: 'select' }
  | { type: 'boolean' }
  | { type: 'number_range' }
  | { type: 'date_range' }
  | { type: 'relation'; endpoint: string; labelField: string; dependsOn?: string }

export interface FieldMeta {
  label?: string
  placeholder?: string
  helpText?: string
  listVisibility?: 'visible' | 'hidden' | 'never'
  showInForm?: boolean
  sortable?: boolean
  /** `time`: an int field holding minutes since 00:00, edited and listed as H:MM (may run past 24:00).
   *  `rest-cycle` / `rest-group`: RestPattern.pattern as a weekly grid / CrewMember.restOffset as its group. */
  widget?: 'textarea' | 'select' | 'combobox' | 'switch' | 'datepicker' | 'password' | 'stepper' | 'email' | 'avatar' | 'currency' | 'object-editor' | 'multi-select' | 'badge' | 'map-picker' | 'time' | 'rest-cycle' | 'rest-group'
  defaultValue?: unknown
  min?: number
  max?: number
  /** HTML minlength/maxlength on text inputs — a UI-only restriction, independent of the Zod string length validation (which stays the source of truth enforced server-side). */
  minLength?: number
  maxLength?: number
  mask?: 'cnpj' | 'cnpj-base' | 'cpf' | 'phone' | 'cep'
  className?: string
  resource?: string
  domain?: string
  labelField?: string
  /** record fields: the field of `resource` whose value is used as the record key */
  keyField?: string
  relatedDisplayFields?: string[]
  relatedWhere?: Record<string, unknown>
  keybind?: string
  filter?: boolean | FilterDef
  optionLabels?: Record<string, string>
  /** For `widget: 'badge'` on enum fields — maps option value to a badge color. Defaults to 'muted'. */
  optionColors?: Record<string, 'success' | 'warning' | 'destructive' | 'info' | 'muted'>
  /** Field exists in the form for UX purposes but is excluded from API payloads on submit. */
  virtual?: boolean
  /** Not a column: the service fills it on read and handles it on write (a link table, a value
   *  from a related record). BaseService leaves it out of relation includes and of the data it
   *  writes — unlike `virtual`, it is part of the API payload. */
  computed?: boolean
  /** Re-fetches select options using `?f_<dependsOn>=<value>` when the named sibling field changes. Clears own value when parent changes. */
  dependsOn?: string
  /** In edit mode, shows the related record label as locked text with an edit button instead of loading all options up front. Fetches only the current record by ID until the user unlocks the field. */
  lazyEdit?: boolean
  /** For `widget: 'map-picker'` — name of the sibling field holding the paired coordinate (e.g. lat's pairField is 'lng'). */
  pairField?: string
  /** Form row label: consecutive fields with the same `row` share one form row under this label,
   *  each with its own `label` as a small caption above it (switches keep theirs beside them). */
  row?: string
  /** On create-only forms, GET this endpoint once on mount and prefill the field with `response[fieldName]` if the field has no value yet. */
  suggestEndpoint?: string
  /** Names of sibling fields to send as query params to `suggestEndpoint`. When set, the suggestion also re-fetches whenever these fields change (not just once on mount), as long as the field itself hasn't been edited by hand. */
  suggestParams?: string[]
  /** Relation fields in a CSV import: the field of `resource` the CSV value is matched against
   *  (case-insensitive). Defaults to `labelField`. With `dependsOn`, the match is narrowed to the
   *  record the sibling column resolved to (e.g. a model's name within its brand). */
  importRef?: string
  /** false keeps a field out of the CSV import; true brings in one the form hides (e.g. a map's lng) */
  importable?: boolean
  /** the field's CSV column name, when the default (the key, `Id` dropped on relations) reads badly */
  importName?: string
  /** an object field imported as one column per property (`field.property`), merged on update */
  importFlatten?: boolean
  // schema-level only
  labelPlural?: string
  nameField?: string
}

export interface MetadataField {
  name: string
  label: string
  placeholder?: string
  helpText?: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'relation' | 'object' | 'array' | 'record'
  required: boolean
  options?: string[]
  defaultValue?: unknown
  listVisibility: 'visible' | 'hidden' | 'never'
  showInForm: boolean
  sortable: boolean
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  mask?: string
  widget?: string
  className?: string
  resource?: string
  domain?: string
  labelField?: string
  keyField?: string
  relatedDisplayFields?: string[]
  relatedWhere?: Record<string, unknown>
  keybind?: string
  group?: string
  filter?: FilterDef
  optionLabels?: Record<string, string>
  optionColors?: Record<string, 'success' | 'warning' | 'destructive' | 'info' | 'muted'>
  virtual?: boolean
  dependsOn?: string
  lazyEdit?: boolean
  pairField?: string
  suggestEndpoint?: string
  suggestParams?: string[]
  row?: string
  fields?: MetadataField[]
  itemFields?: MetadataField[]
}

export interface TabGroup {
  label:  string
  fields: string[]
}

export interface ResourceAction {
  key: string
  label: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  icon?: string
}

export interface AuthUser {
  id:        string
  role:      string
  branchIds: string[]
}

export type ThemeName = 'eucalyptus' | 'ocean' | 'sunset' | 'lavender' | 'rose' | 'slate'

export interface UserPreferences {
  theme:            ThemeName
  sidebarCollapsed: boolean
  dateFormat:       'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
}

export const defaultPreferences: UserPreferences = {
  theme:            'slate',
  sidebarCollapsed: false,
  dateFormat:       'DD/MM/YYYY',
}

export interface CurrentUser {
  id:                  string
  name:                string
  username:            string
  role:                string
  branchIds:           string[]
  preferences:         UserPreferences
  forcePasswordChange: boolean
}

export interface ResourcePermissions {
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
}

export interface ChildResourceDef {
  resource:            string
  domain?:             string
  label:               string
  contextField:        string
  keybind?:            string
  overflow?:           boolean
  privatePermissions?: boolean
  importable?:         boolean  // has the CSV import — the parent's list offers it too
}

export interface BreadcrumbDef {
  resource:     string
  domain?:      string
  contextField: string
  listLabel?:   string
  nameField?:    string
  nameFirstWord?: boolean  // show only the first word of the name in the breadcrumb; default true
  keybind?:      string   // atalho do botão que o PAI renderiza para navegar até este filho
  overflow?:     boolean  // força o botão do PAI para este filho a ir para o dropdown ⋯ do topbar
  order?:        number   // position among the parent's child buttons — ascending, default 0; ties keep registration order
}

export interface DiscoveryResource {
  key:                 string
  label:               string
  labelPlural:         string
  icon:                string
  nameField:           string
  isSingleton?:        boolean
  privatePermissions?: boolean  // exige concessão explícita; não aparece no sidebar
  featured?:           number   // principal do domínio: vem primeiro (nesta ordem) e com destaque
}

export interface DiscoveryDomain {
  key:       string
  label:     string
  icon:      string
  resources: DiscoveryResource[]
}

export function apiRoute(domain: string, resource: string, suffix?: string): string {
  return `/${domain}/${resource}${suffix ? `/${suffix}` : ''}`
}

export function navRoute(domain: string, resource: string, suffix?: string): string {
  return `/${domain}/${resource}${suffix ? `/${suffix}` : ''}`
}

export interface RowActionDef {
  action:            string
  label:             string
  icon:              string
  variant?:          'default' | 'destructive'
  group?:            string
  permission:        'create' | 'read' | 'update' | 'delete'
  hrefTemplate?:     string
  method?:           'POST' | 'PATCH' | 'DELETE'
  endpointTemplate?: string
  body?:             Record<string, unknown>
  visibleWhen?:      { field: string; value: unknown }
}

// CSV import: an accepted value of a column, as the import modal lists it
export interface ImportValue {
  value:  string
  label:  string
  group?: string
}

// CSV import (see docs/FLOW.md) — a column of the import file
export interface ImportColumn {
  name:     string    // CSV header: the field key, without the `Id` suffix on relations
  field:    string    // schema field it fills
  label:    string
  type:     'string' | 'number' | 'boolean' | 'date' | 'time' | 'enum' | 'relation' | 'list'
  item?:    'string' | 'enum' | 'relation'  // list: what each `|`-separated value is (options / ref apply to it)
  key:      boolean   // part of the sync key (importKey)
  required: boolean   // required when the row creates a record
  options?: string[]  // enum values
  values?:  ImportValue[]  // accepted values to show the user (enums with their labels, or a service's list)
  mask?:    string    // cpf, cnpj, cep, phone — digits or formatted in the file, stored formatted
  ref?:     string    // relation: the related resource's field matched against
  group?:   string    // importNested: the related record this column fills (required = when the group is filled)
  object?:  string    // importFlatten: the object field this column is a property of
  groupLabel?: string
}

export interface ImportMeta {
  columns: ImportColumn[]   // key columns first
  notice?: string           // shown in the import modal (e.g. the file holds passwords)
}

export interface ImportIssue {
  column?: string
  message: string
}

export interface ImportRow {
  line:   number                   // line in the CSV (header is line 1)
  action: 'create' | 'update' | null
  values: Record<string, string>   // raw cells, by column
  errors: ImportIssue[]
}

export interface ImportResult {
  dryRun:  boolean
  columns: string[]                // headers in file order
  errors:  ImportIssue[]           // file-level (encoding, header, size) — no rows when present
  rows:    ImportRow[]
  total:   number
  invalid: number
  created: number
  updated: number
}

export interface ResourceMetadata {
  resource:      string
  label:         string
  labelPlural:   string
  nameField:     string
  allowCsv:      boolean
  isSingleton?:  boolean
  permissions:   ResourcePermissions
  fields:        MetadataField[]
  actions:       ResourceAction[]
  groups?:       TabGroup[]
  nameFirstWord?: boolean
  breadcrumb?:   BreadcrumbDef[]
  children?:     ChildResourceDef[]   // derivado automaticamente pelo backend via registry
  rowActions?:   RowActionDef[]
  afterCreate?:      string               // template {fieldName} — redireciona após criação em vez de ir para a lista
  stayOnSave?:       boolean              // after saving, stay on the record instead of going to the list
  defaultFilters?:   Record<string, string>  // filtros pré-aplicados na lista; o usuário pode modificar/limpar
  import?:           ImportMeta           // present when the schema declares importKey
}
