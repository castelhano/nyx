import {
  Shield, Users, Building, Building2, GitBranch, Lock, Settings,
  LayoutGrid, Package, Truck, ShoppingCart, FileText, BarChart2,
  Palette, CalendarDays, SlidersHorizontal, ArrowRightFromLine, Layers, Briefcase,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

export const Icons: Record<string, LucideIcon> = {
  Shield,
  Users,
  UserRound,
  Building,
  Building2,
  GitBranch,
  Lock,
  Settings,
  Package,
  Truck,
  ShoppingCart,
  FileText,
  BarChart2,
  Palette,
  CalendarDays,
  SlidersHorizontal,
  ArrowRightFromLine,
  Layers,
  Briefcase,
  Default: LayoutGrid,
}

export function resolveIcon(name?: string | null): LucideIcon {
  return (name && Icons[name]) ? Icons[name] : Icons.Default
}
