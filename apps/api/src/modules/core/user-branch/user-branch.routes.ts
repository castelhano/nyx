export const UserBranchRoutes = {
  root:        '/core/user-branch',
  metadata:    '/core/user-branch/metadata',
  byId:        (id: string) => `/core/user-branch/${id}`,
  byUser:      (userId: string) => `/core/user-branch/by-user/${userId}`,
  byBranch:    (branchId: string) => `/core/user-branch/by-branch/${branchId}`,
  setForUser:  (userId: string) => `/core/user-branch/by-user/${userId}`,
} as const
