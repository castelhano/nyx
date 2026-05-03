"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseService = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const prisma_service_1 = require("../prisma/prisma.service");
const metadata_builder_1 = require("./metadata.builder");
let BaseService = class BaseService {
    prisma;
    modelName;
    schema;
    constructor(prisma, modelName, schema) {
        this.prisma = prisma;
        this.modelName = modelName;
        this.schema = schema;
    }
    get model() {
        return this.prisma[this.modelName];
    }
    async findAll(query) {
        const page = Number(query.page) || 1;
        const pageSize = Number(query.pageSize) || 20;
        const where = query.search ? this.buildSearchWhere(query.search) : {};
        const orderBy = query.sortField
            ? { [query.sortField]: query.sortOrder ?? 'asc' }
            : { createdAt: 'desc' };
        const [data, total] = await Promise.all([
            this.model.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
            this.model.count({ where }),
        ]);
        return { data, total, page, pageSize };
    }
    async findOne(id) {
        const item = await this.model.findUnique({ where: { id } });
        if (!item)
            throw new common_1.NotFoundException(`${this.modelName} not found`);
        return item;
    }
    async create(dto) {
        return this.model.create({ data: dto });
    }
    async update(id, dto) {
        await this.findOne(id);
        return this.model.update({ where: { id }, data: dto });
    }
    async remove(id) {
        await this.findOne(id);
        await this.model.delete({ where: { id } });
    }
    getMetadata() {
        return (0, metadata_builder_1.buildMetadata)(this.modelName, this.schema);
    }
    buildSearchWhere(_search) {
        return {};
    }
};
exports.BaseService = BaseService;
exports.BaseService = BaseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, String, zod_1.ZodObject])
], BaseService);
