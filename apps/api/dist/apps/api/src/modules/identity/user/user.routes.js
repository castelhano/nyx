"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRoutes = void 0;
exports.UserRoutes = {
    root: '/identity/users',
    metadata: '/identity/users/metadata',
    byId: (id) => `/identity/users/${id}`,
    deactivate: (id) => `/identity/users/${id}/deactivate`,
    changePassword: (id) => `/identity/users/${id}/change-password`,
};
