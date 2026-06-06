import * as Lucide from 'lucide-react'
export type { LucideIcon } from 'lucide-react'

const iconNames = [
  'Shield', 'Users', 'UserRound', 'Building', 'Building2', 'GitBranch', 'Lock', 'Settings',
  'Package', 'Truck', 'Bus', 'Tag', 'ShoppingCart', 'FileText', 'BarChart2',
  'Palette', 'CalendarDays', 'SlidersHorizontal', 'ArrowRightFromLine', 'Layers', 'Briefcase',
  'MapPin', 'Route', 'Timer', 'Warehouse', 'CalendarRange', 'CalendarSync', 'LayoutList',
  'Settings2', 'Save', 'ArrowLeft', 'ChevronDown', 'Copy', 'Trash2',
  'Play', 'Square', 'Check', 'CheckCircle', 'CheckSquare', 'MinusSquare', 'Download',
  'Plus', 'X', 'List', 'Info', 'ClipboardList', 'Upload', 'Loader2', 'AlertCircle',
  'KeyRound', 'RefreshCw',
] as const

export const Icons = Object.fromEntries(
  iconNames.map(n => [n, Lucide[n as keyof typeof Lucide]])
) as Record<(typeof iconNames)[number], Lucide.LucideIcon> & { Default: Lucide.LucideIcon }

Icons.Default = Lucide.LayoutGrid

export function resolveIcon(name?: string | null): Lucide.LucideIcon {
  return (name && Icons[name as keyof typeof Icons]) ? Icons[name as keyof typeof Icons] : Icons.Default
}
