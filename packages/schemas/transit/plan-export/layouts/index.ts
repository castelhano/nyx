import type { ExternalSystem } from '../external-system'
import type { ExportLayoutDef } from '../plan-export.types'
import { GLOBUS_LAYOUT_DEF } from './globus.layout'

export const EXPORT_LAYOUTS: Record<ExternalSystem, ExportLayoutDef> = {
  GLOBUS: GLOBUS_LAYOUT_DEF,
}
