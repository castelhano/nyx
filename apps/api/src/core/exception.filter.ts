import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'

const PRISMA_ERRORS: Record<string, { status: number; code: string }> = {
  P2002: { status: 409, code: 'UNIQUE_VIOLATION'      },
  P2003: { status: 409, code: 'FOREIGN_KEY_VIOLATION' },
  P2025: { status: 404, code: 'NOT_FOUND'             },
  P2014: { status: 409, code: 'RELATION_VIOLATION'    },
}

function isPrismaKnownError(e: unknown): e is { code: string; meta?: Record<string, unknown> } {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && typeof (e as Record<string, unknown>).code === 'string' &&
    ((e as Record<string, unknown>).code as string).startsWith('P')
  )
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<Request>()

    if (isPrismaKnownError(exception)) {
      const def = PRISMA_ERRORS[exception.code]
      if (def) {
        const fields: string[] =
          (exception.meta?.target as string[] | undefined) ??
          ((exception.meta?.driverAdapterError as any)?.cause?.constraint?.fields as string[] | undefined) ??
          []
        this.logger.warn(`${req.method} ${req.url} → ${exception.code} ${def.code} fields=${fields.join(',')}`)
        return res.status(def.status).json({
          statusCode: def.status,
          timestamp:  new Date().toISOString(),
          path:       req.url,
          message: {
            statusCode: def.status,
            code:       def.code,
            fields,
          },
        })
      }
    }

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error'

    this.logger.error(exception)

    res.status(status).json({
      statusCode: status,
      timestamp:  new Date().toISOString(),
      path:       req.url,
      message,
    })
  }
}
