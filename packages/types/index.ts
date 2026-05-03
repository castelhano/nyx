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
}

export interface FieldMeta {
  label?: string
  showInList?: boolean
  showInForm?: boolean
  sortable?: boolean
  searchable?: boolean
  widget?: 'textarea' | 'select' | 'combobox' | 'switch' | 'datepicker' | 'password'
  mask?: 'cnpj' | 'cpf' | 'phone' | 'cep'
  resource?: string
  labelField?: string
}

export interface MetadataField {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'relation'
  required: boolean
  options?: string[]
  showInList: boolean
  showInForm: boolean
  sortable: boolean
  searchable: boolean
  mask?: string
  widget?: string
  resource?: string
  labelField?: string
}

export interface ResourceAction {
  key: string
  label: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  icon?: string
}

export interface ResourcePermissions {
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
}

export interface ResourceMetadata {
  resource: string
  label: string
  permissions: ResourcePermissions
  fields: MetadataField[]
  actions: ResourceAction[]
}
