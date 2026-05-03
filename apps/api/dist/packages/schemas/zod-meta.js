"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
zod_1.ZodType.prototype.meta = function (metadata) {
    this._fieldMeta = { ...(this._fieldMeta ?? {}), ...metadata };
    return this;
};
