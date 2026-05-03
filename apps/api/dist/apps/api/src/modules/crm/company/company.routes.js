"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompanyRoutes = void 0;
exports.CompanyRoutes = {
    root: '/crm/companies',
    metadata: '/crm/companies/metadata',
    byId: (id) => `/crm/companies/${id}`,
    deactivate: (id) => `/crm/companies/${id}/deactivate`,
};
