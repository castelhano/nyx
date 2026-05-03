"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaginationInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
let PaginationInterceptor = class PaginationInterceptor {
    intercept(context, next) {
        return next.handle().pipe((0, operators_1.tap)((data) => {
            if (data && typeof data === 'object' && 'total' in data && 'page' in data && 'pageSize' in data) {
                const res = context.switchToHttp().getResponse();
                res.setHeader('X-Total-Count', data.total);
                res.setHeader('X-Page', data.page);
                res.setHeader('X-Page-Size', data.pageSize);
            }
        }));
    }
};
exports.PaginationInterceptor = PaginationInterceptor;
exports.PaginationInterceptor = PaginationInterceptor = __decorate([
    (0, common_1.Injectable)()
], PaginationInterceptor);
