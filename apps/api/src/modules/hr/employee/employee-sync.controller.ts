import {
  Controller, Post, Get, UseGuards, UseInterceptors,
  UploadedFile, Body, Request, BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { JwtAuthGuard } from '../../../auth/policies.guard'
import { EmployeeSyncService } from './employee-sync.service'
import type { MetadataField } from '@nyx/types'

@Controller('hr/employee/sync')
@UseGuards(JwtAuthGuard)
export class EmployeeSyncController {
  constructor(private readonly syncService: EmployeeSyncService) {}

  @Get('fields')
  getFields(): { fields: MetadataField[] } {
    const fields: MetadataField[] = [
      {
        name:           'companyId',
        label:          'Empresa',
        type:           'relation',
        required:       false,
        listVisibility: 'never',
        showInForm:     true,
        sortable:       false,
        widget:         'select',
        resource:       'company',
        domain:         'core',
        labelField:     'tradeName',
        virtual:        true,
      },
      {
        name:           'branchId',
        label:          'Filial',
        type:           'relation',
        required:       true,
        listVisibility: 'never',
        showInForm:     true,
        sortable:       false,
        widget:         'select',
        resource:       'branch',
        domain:         'core',
        labelField:     'name',
        dependsOn:      'companyId',
      },
    ]
    return { fields }
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },
  }))
  async sync(
    @UploadedFile() file: Express.Multer.File,
    @Body('branchId') branchId: string,
    @Request() req: any,
  ) {
    if (!file)     throw new BadRequestException('Arquivo não enviado')
    if (!branchId) throw new BadRequestException('Filial obrigatória')
    return this.syncService.sync(file, branchId, req.user.id)
  }
}
