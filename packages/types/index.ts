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
  widget?: 'textarea' | 'select' | 'combobox' | 'switch' | 'datepicker' | 'password' | 'stepper' | 'email' | 'avatar' | 'currency' | 'object-editor'
  defaultValue?: unknown
  min?: number
  max?: number
  mask?: 'cnpj' | 'cnpj-base' | 'cpf' | 'phone' | 'cep'
  className?: string
  resource?: string
  domain?: string
  labelField?: string
  relatedDisplayFields?: string[]
  relatedWhere?: Record<string, unknown>
  keybind?: string
  filter?: boolean | FilterDef
  optionLabels?: Record<string, string>
  /** Field exists in the form for UX purposes but is excluded from API payloads on submit. */
  virtual?: boolean
  /** Re-fetches select options using `?f_<dependsOn>=<value>` when the named sibling field changes. Clears own value when parent changes. */
  dependsOn?: string
  /** In edit mode, shows the related record label as locked text with an edit button instead of loading all options up front. Fetches only the current record by ID until the user unlocks the field. */
  lazyEdit?: boolean
  // schema-level only
  labelPlural?: string
  nameField?: string
}

export interface MetadataField {
  name: string
  label: string
  placeholder?: string
  helpText?: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'relation' | 'object' | 'array'
  required: boolean
  options?: string[]
  defaultValue?: unknown
  listVisibility: 'visible' | 'hidden' | 'never'
  showInForm: boolean
  sortable: boolean
  min?: number
  max?: number
  mask?: string
  widget?: string
  className?: string
  resource?: string
  domain?: string
  labelField?: string
  relatedDisplayFields?: string[]
  relatedWhere?: Record<string, unknown>
  keybind?: string
  group?: string
  filter?: FilterDef
  optionLabels?: Record<string, string>
  virtual?: boolean
  dependsOn?: string
  lazyEdit?: boolean
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
  privatePermissions?: boolean
}

export interface BreadcrumbDef {
  resource:     string
  domain?:      string
  contextField: string
  listLabel?:   string
  nameField?:    string
  nameFirstWord?: boolean  // show only the first word of the name in the breadcrumb; default true
  keybind?:      string   // atalho do botão que o PAI renderiza para navegar até este filho
}

export interface DiscoveryResource {
  key:                 string
  label:               string
  labelPlural:         string
  icon:                string
  isSingleton?:        boolean
  privatePermissions?: boolean  // exige concessão explícita; não aparece no sidebar
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
  breadcrumb?:   BreadcrumbDef[]
  children?:     ChildResourceDef[]   // derivado automaticamente pelo backend via registry
  rowActions?:   RowActionDef[]
  afterCreate?:      string               // template {fieldName} — redireciona após criação em vez de ir para a lista
  defaultFilters?:   Record<string, string>  // filtros pré-aplicados na lista; o usuário pode modificar/limpar
}
