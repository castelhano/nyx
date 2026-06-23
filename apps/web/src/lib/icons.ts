import * as Lucide from 'lucide-react'
export type { LucideIcon } from 'lucide-react'

const iconNames = [
  'AlertCircle',
  'ArrowLeft',
  'ArrowRight',
  'ArrowRightFromLine',
  'ArrowRightLeft',
  'BarChart2',
  'Briefcase',
  'Building',
  'Building2',
  'Bus',
  'CalendarDays',
  'CalendarRange',
  'CalendarSync',
  'Check',
  'CheckCircle',
  'CheckSquare',
  'ChevronDown',
  'ClipboardList',
  'Copy',
  'Download',
  'FileText',
  'GitBranch',
  'Info',
  'KeyRound',
  'Layers',
  'LayoutList',
  'List',
  'Lock',
  'LockOpen',
  'Loader2',
  'MapPin',
  'MinusSquare',
  'Option',
  'Package',
  'Palette',
  'Play',
  'Plus',
  'RefreshCw',
  'Route',
  'Save',
  'Scissors',
  'Settings',
  'Settings2',
  'Shield',
  'ShoppingCart',
  'SlidersHorizontal',
  'Square',
  'Tag',
  'Timer',
  'Trash2',
  'Undo2',
  'Truck',
  'Upload',
  'UserRound',
  'Users',
  'Warehouse',
  'X',
  'ZoomIn',
  'ZoomOut',
] as const

export const Icons = Object.fromEntries(
  iconNames.map(n => [n, Lucide[n as keyof typeof Lucide]])
) as Record<(typeof iconNames)[number], Lucide.LucideIcon> & { Default: Lucide.LucideIcon }

Icons.Default = Lucide.LayoutGrid

export function resolveIcon(name?: string | null): Lucide.LucideIcon {
  return (name && Icons[name as keyof typeof Icons]) ? Icons[name as keyof typeof Icons] : Icons.Default
}
