"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCompanySchema = exports.createCompanySchema = exports.companySchema = void 0;
const zod_1 = require("zod");
require("../zod-meta");
exports.companySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    legalName: zod_1.z.string().min(2).meta({ label: 'Legal Name', showInList: true }),
    tradeName: zod_1.z.string().nullable().meta({ label: 'Trade Name', showInList: true }),
    taxId: zod_1.z.string().meta({ label: 'Tax ID', mask: 'cnpj', searchable: true }),
    type: zod_1.z.enum(['client', 'supplier', 'partner', 'other']).meta({ label: 'Type', showInList: true }),
    isActive: zod_1.z.boolean().default(true).meta({ label: 'Active', showInList: true }),
    createdAt: zod_1.z.date().meta({ showInForm: false }),
    updatedAt: zod_1.z.date().meta({ showInForm: false }),
});
exports.createCompanySchema = exports.companySchema.omit({ id: true, createdAt: true, updatedAt: true });
exports.updateCompanySchema = exports.createCompanySchema.partial();
