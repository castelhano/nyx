import { Injectable, ExecutionContext } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// SSE endpoints: EventSource doesn't support custom headers, so accept token via query param
@Injectable()
export class JwtOrQueryGuard extends AuthGuard('jwt') {
  override getRequest(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest()
    if (req.query?.token && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${req.query.token}`
    }
    return req
  }
}
