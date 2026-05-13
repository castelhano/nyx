export interface DomainEntry {
  key:   string
  label: string
  icon:  string
}

const domainRegistry: DomainEntry[] = []

function keyFromClassName(name: string): string {
  // 'CoreModule' → 'core', 'SettingsModule' → 'settings'
  return name.replace(/Module$/, '').toLowerCase()
}

export function Domain(meta: { label: string; icon: string }): ClassDecorator {
  return (target) => {
    const key = keyFromClassName(target.name)
    domainRegistry.push({ key, ...meta })
  }
}

export function getDomainRegistry(): DomainEntry[] {
  return domainRegistry
}
