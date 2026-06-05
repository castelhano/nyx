import {
  Controller, Post, Get, UseGuards, UseInterceptors,
  UploadedFile, Body, Request, BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { JwtAuthGuard } from '../../../../auth/policies.guard'
import { VehiclePlanImportService } from './vehicle-plan-import.service'
import type { MetadataField } from '@nyx/types'

@Controller('transit/vehicle-plan/sync')
@UseGuards(JwtAuthGuard)
export class VehiclePlanImportController {
  constructor(private readonly importService: VehiclePlanImportService) {}

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
      {
        name:           'dayTypeId',
        label:          'Tipo de Dia',
        type:           'relation',
        required:       true,
        listVisibility: 'never',
        showInForm:     true,
        sortable:       false,
        widget:         'select',
        resource:       'day-type',
        domain:         'transit',
        labelField:     'name',
      },
      {
        name:           'depotId',
        label:          'Garagem',
        type:           'relation',
        required:       true,
        listVisibility: 'never',
        showInForm:     true,
        sortable:       false,
        widget:         'select',
        resource:       'transit-locality',
        domain:         'transit',
        labelField:     'name',
        relatedWhere:   { isDepot: true },
      },
      {
        name:           'setupMinutes',
        label:          'Preparo (min)',
        type:           'number',
        required:       false,
        listVisibility: 'never',
        showInForm:     true,
        sortable:       false,
      },
    ]
    return { fields }
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits:  { fileSize: 20 * 1024 * 1024 },
  }))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body('branchId')      branchId:         string,
    @Body('dayTypeId')     dayTypeId:        string,
    @Body('depotId')       depotId:          string,
    @Body('setupMinutes')  setupMinutesRaw:  string | undefined,
    @Body('planId')        planId:           string | undefined,
    @Request() req: any,
  ) {
    if (!file)                  throw new BadRequestException('Arquivo não enviado')
    if (!branchId)              throw new BadRequestException('Filial obrigatória')
    if (!planId && !dayTypeId)  throw new BadRequestException('Tipo de dia obrigatório')
    if (!depotId)               throw new BadRequestException('Garagem obrigatória')

    const setupMinutes = parseInt(setupMinutesRaw ?? '0', 10) || 0

    return this.importService.import(file, branchId, dayTypeId, depotId, req.user.id, setupMinutes, planId || undefined)
  }
}
