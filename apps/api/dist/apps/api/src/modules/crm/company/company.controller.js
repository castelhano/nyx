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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompanyController = void 0;
const common_1 = require("@nestjs/common");
const base_controller_1 = require("../../../core/base.controller");
const policies_guard_1 = require("../../../auth/policies.guard");
const company_service_1 = require("./company.service");
let CompanyController = class CompanyController extends base_controller_1.BaseController {
    companyService;
    constructor(companyService) {
        super(companyService);
        this.companyService = companyService;
    }
    deactivate(id) {
        return this.companyService.deactivate(id);
    }
};
exports.CompanyController = CompanyController;
__decorate([
    (0, common_1.Post)(':id/deactivate'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CompanyController.prototype, "deactivate", null);
exports.CompanyController = CompanyController = __decorate([
    (0, common_1.Controller)('crm/companies'),
    (0, common_1.UseGuards)(policies_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [company_service_1.CompanyService])
], CompanyController);
