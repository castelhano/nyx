export const CompanyRoutes = {
  root:       '/crm/companies',
  metadata:   '/crm/companies/metadata',
  byId:       (id: string) => `/crm/companies/${id}`,
  deactivate: (id: string) => `/crm/companies/${id}/deactivate`,
} as const
