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
  showInList?: boolean
  showInForm?: boolean
  sortable?: boolean
  searchable?: boolean
  widget?: 'textarea' | 'select' | 'combobox' | 'switch' | 'datepicker' | 'password' | 'stepper'
  min?: number
  max?: number
  mask?: 'cnpj' | 'cnpj-base' | 'cpf' | 'phone' | 'cep'
  className?: string
  resource?: string
  labelField?: string
  keybind?: string
  filter?: boolean | FilterDef
  // schema-level only
  labelPlural?: string
  nameField?: string
}

export interface MetadataField {
  name: string
  label: string
  placeholder?: string
  helpText?: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'relation'
  required: boolean
  options?: string[]
  defaultValue?: unknown
  listVisibility: 'visible' | 'hidden' | 'never'
  showInList: boolean
  showInForm: boolean
  sortable: boolean
  searchable: boolean
  min?: number
  max?: number
  mask?: string
  widget?: string
  className?: string
  resource?: string
  labelField?: string
  keybind?: string
  group?: string
  filter?: FilterDef
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

export interface ResourcePermissions {
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
}

export interface ChildResourceDef {
  resource:     string
  domain?:      string
  label:        string
  contextField: string
  keybind?:     string
}

export interface BreadcrumbDef {
  resource:     string
  domain?:      string
  contextField: string
  listLabel?:   string
  nameField?:   string
  keybind?:     string   // atalho do botão que o PAI renderiza para navegar até este filho
}

export interface DiscoveryResource {
  key:          string
  label:        string
  labelPlural:  string
  icon:         string
  isSingleton?: boolean
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
  resource:     string
  label:        string
  labelPlural:  string
  nameField:    string
  allowCsv:     boolean
  isSingleton?: boolean
  permissions:  ResourcePermissions
  fields:       MetadataField[]
  actions:      ResourceAction[]
  groups?:      TabGroup[]
  breadcrumb?:  BreadcrumbDef[]
  children?:    ChildResourceDef[]   // derivado automaticamente pelo backend via registry
  rowActions?:  RowActionDef[]
}
