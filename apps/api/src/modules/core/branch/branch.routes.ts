export const BranchRoutes = {
  root:          '/core/branch',
  metadata:      '/core/branch/metadata',
  byId:          (id: string) => `/core/branch/${id}`,
  deactivate:    (id: string) => `/core/branch/${id}/deactivate`,
  byCompany:     (companyId: string) => `/core/branch/by-company/${companyId}`,
} as const
