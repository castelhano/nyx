export const UserPermissionRoutes = {
  root:       '/core/user-permission',
  metadata:   '/core/user-permission/metadata',
  byId:       (id: string) => `/core/user-permission/${id}`,
  byUser:     (userId: string) => `/core/user-permission/by-user/${userId}`,
  setForUser: (userId: string) => `/core/user-permission/by-user/${userId}`,
} as const
