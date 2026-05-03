"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePasswordSchema = exports.updateUserSchema = exports.createUserSchema = exports.userSchema = void 0;
const zod_1 = require("zod");
require("../zod-meta");
exports.userSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(2).meta({ label: 'Name', showInList: true }),
    email: zod_1.z.string().email().meta({ label: 'Email', showInList: true, searchable: true }),
    passwordHash: zod_1.z.string().meta({ showInList: false, showInForm: false }),
    role: zod_1.z.enum(['admin', 'operator', 'viewer']).meta({ label: 'Role', showInList: true }),
    isActive: zod_1.z.boolean().default(true).meta({ label: 'Active', showInList: true }),
    createdAt: zod_1.z.date().meta({ showInForm: false }),
    updatedAt: zod_1.z.date().meta({ showInForm: false }),
});
exports.createUserSchema = exports.userSchema
    .omit({ id: true, createdAt: true, updatedAt: true, passwordHash: true })
    .extend({ password: zod_1.z.string().min(8).meta({ label: 'Password', widget: 'password' }) });
exports.updateUserSchema = exports.createUserSchema.partial();
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string(),
    newPassword: zod_1.z.string().min(8),
});
