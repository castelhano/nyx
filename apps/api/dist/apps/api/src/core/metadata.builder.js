"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMetadata = buildMetadata;
const zod_1 = require("zod");
function unwrap(field) {
    if (field instanceof zod_1.ZodOptional || field instanceof zod_1.ZodNullable || field instanceof zod_1.ZodDefault) {
        return unwrap(field._def.innerType);
    }
    return field;
}
function getType(field) {
    const inner = unwrap(field);
    if (inner instanceof zod_1.ZodString)
        return 'string';
    if (inner instanceof zod_1.ZodNumber)
        return 'number';
    if (inner instanceof zod_1.ZodBoolean)
        return 'boolean';
    if (inner instanceof zod_1.ZodDate)
        return 'date';
    if (inner instanceof zod_1.ZodEnum)
        return 'enum';
    return 'string';
}
function isRequired(field) {
    return !(field instanceof zod_1.ZodOptional) && !(field instanceof zod_1.ZodNullable);
}
function toTitleCase(str) {
    return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}
function buildMetadata(resource, schema) {
    const fields = [];
    for (const [name, rawField] of Object.entries(schema.shape)) {
        const field = rawField;
        const meta = field._fieldMeta ?? {};
        const type = getType(field);
        const inner = unwrap(field);
        const isPassword = name === 'passwordHash' || meta.widget === 'password';
        const isTimestamp = name === 'createdAt' || name === 'updatedAt';
        const isId = name === 'id';
        fields.push({
            name,
            label: meta.label ?? toTitleCase(name),
            type,
            required: isRequired(field),
            options: type === 'enum' ? inner._def.values : undefined,
            showInList: meta.showInList ?? (!isId && !isPassword && !isTimestamp),
            showInForm: meta.showInForm ?? (!isId && !isPassword && !isTimestamp),
            sortable: meta.sortable ?? (type === 'string' || type === 'number' || type === 'date'),
            searchable: meta.searchable ?? false,
            ...(meta.mask ? { mask: meta.mask } : {}),
            ...(meta.widget ? { widget: meta.widget } : {}),
            ...(meta.resource ? { resource: meta.resource } : {}),
            ...(meta.labelField ? { labelField: meta.labelField } : {}),
        });
    }
    return {
        resource,
        label: toTitleCase(resource),
        permissions: { create: true, read: true, update: true, delete: true },
        fields,
        actions: [],
    };
}
