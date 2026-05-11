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

export interface FieldMeta {
  label?: string
  placeholder?: string
  helpText?: string
  listVisibility?: 'visible' | 'hidden' | 'never'
  showInList?: boolean
  showInForm?: boolean
  sortable?: boolean
  searchable?: boolean
  widget?: 'textarea' | 'select' | 'combobox' | 'switch' | 'datepicker' | 'password'
  mask?: 'cnpj' | 'cnpj-base' | 'cpf' | 'phone' | 'cep'
  className?: string
  resource?: string
  labelField?: string
  keybind?: string
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
  mask?: string
  widget?: string
  className?: string
  resource?: string
  labelField?: string
  keybind?: string
  group?: string
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
}

export interface ResourceMetadata {
  resource:    string
  label:       string
  labelPlural: string
  nameField:   string
  allowCsv:    boolean
  permissions: ResourcePermissions
  fields:      MetadataField[]
  actions:     ResourceAction[]
  groups?:     TabGroup[]
  breadcrumb?: BreadcrumbDef[]
  children?:   ChildResourceDef[]
}
