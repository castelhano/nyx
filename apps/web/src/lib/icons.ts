import {
  Shield, Users, Building, Building2, GitBranch, Lock, Settings,
  LayoutGrid, Package, Truck, ShoppingCart, FileText, BarChart2,
  type LucideIcon,
} from 'lucide-react'

export const Icons: Record<string, LucideIcon> = {
  Shield,
  Users,
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
  Default: LayoutGrid,
}

export function resolveIcon(name?: string | null): LucideIcon {
  return (name && Icons[name]) ? Icons[name] : Icons.Default
}
