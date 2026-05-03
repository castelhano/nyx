import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

@Injectable()
export class PaginationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap((data) => {
        if (data && typeof data === 'object' && 'total' in data && 'page' in data && 'pageSize' in data) {
          const res = context.switchToHttp().getResponse()
          res.setHeader('X-Total-Count', data.total)
          res.setHeader('X-Page',        data.page)
          res.setHeader('X-Page-Size',   data.pageSize)
        }
      }),
    )
  }
}
