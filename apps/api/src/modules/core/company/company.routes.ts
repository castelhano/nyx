export const CompanyRoutes = {
  root:       '/core/company',
  metadata:   '/core/company/metadata',
  byId:       (id: string) => `/core/company/${id}`,
  deactivate: (id: string) => `/core/company/${id}/deactivate`,
} as const
