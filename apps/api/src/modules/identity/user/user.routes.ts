export const UserRoutes = {
  root:           '/identity/users',
  metadata:       '/identity/users/metadata',
  byId:           (id: string) => `/identity/users/${id}`,
  deactivate:     (id: string) => `/identity/users/${id}/deactivate`,
  changePassword: (id: string) => `/identity/users/${id}/change-password`,
} as const
