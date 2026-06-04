import { Injectable } from '@nestjs/common'
import { lineSchema, Line, CreateLineDto, UpdateLineDto } from '@nyx/schemas'
import { PrismaService } from '../../../../prisma/prisma.service'
import { BaseService } from '../../../../core/base.service'
import { stringContains } from '../../../../core/db.utils'
import type { PaginatedResult, PaginationQuery } from '@nyx/types'

// Pure-numeric codes sort as numbers; mixed/alpha codes sort after, then localeCompare.
// e.g. 31 < 105 < 301 < 800 < A02 < A22B < C01 < R03
function sortByCode(a: string, b: string): number {
  const na = Number(a), nb = Number(b)
  const aNum = !isNaN(na) && String(na) === a
  const bNum = !isNaN(nb) && String(nb) === b
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  return a.localeCompare(b)
}

@Injectable()
export class LineService extends BaseService<Line, CreateLineDto, UpdateLineDto> {
  constructor(prisma: PrismaService) {
    super(prisma, 'transitLine', lineSchema, 'transit')
  }

  protected buildSearchWhere(search: string) {
    return {
      OR: [
        { name: stringContains(search) },
        { code: stringContains(search) },
      ],
    }
  }

  override async findAll(query: PaginationQuery): Promise<PaginatedResult<Line>> {
    if (query.sortField) return super.findAll(query)
    const all  = await super.findAll({ ...query, page: 1, pageSize: 10_000 })
    const sorted = [...all.data].sort((a, b) => sortByCode((a as any).code, (b as any).code))
    const page = query.page ?? 1
    const size = query.pageSize ?? 20
    return { data: sorted.slice((page - 1) * size, page * size), total: all.total, page, pageSize: size }
  }
}
