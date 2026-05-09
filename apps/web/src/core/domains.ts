import { Shield, Users, Building2, Building } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface DomainResource {
  key:   string
  label: string
  icon:  LucideIcon
}

export interface DomainConfig {
  label:     string
  icon:      LucideIcon
  resources: DomainResource[]
}

export const domains: Record<string, DomainConfig> = {
  identity: {
    label: 'Controle',
    icon:  Shield,
    resources: [
      { key: 'user', label: 'Usuários', icon: Users },
      { key: 'company', label: 'Empresas', icon: Building },
    ],
  },
}
