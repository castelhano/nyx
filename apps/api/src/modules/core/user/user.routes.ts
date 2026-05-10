export const UserRoutes = {
  root:           '/core/user',
  metadata:       '/core/user/metadata',
  byId:           (id: string) => `/core/user/${id}`,
  deactivate:     (id: string) => `/core/user/${id}/deactivate`,
  changePassword: (id: string) => `/core/user/${id}/change-password`,
} as const
