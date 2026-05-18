'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, ArrowLeft, Palette, SlidersHorizontal, CalendarDays } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/lib/toast-context'
import { ThemeCard } from '@/components/ui/theme-card'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { type ThemeName, type UserPreferences, defaultPreferences } from '@nyx/types'

const FORM_ID      = 'preferences-form'
const THEME_ORDER: ThemeName[] = ['eucalyptus', 'ocean', 'sunset', 'lavender', 'rose', 'slate']

// ─── PrefsSection ─────────────────────────────────────────────────────────────

function PrefsSection({ icon: Icon, label, children }: {
  icon:     React.ComponentType<{ className?: string }>
  label:    string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {children}
      </div>
    </section>
  )
}

// ─── PrefsRow ─────────────────────────────────────────────────────────────────

function PrefsRow({ label, description, children }: {
  label:        string
  description?: string
  children:     React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PreferencesPage() {
  const router                       = useRouter()
  const { user, updatePreferences }  = useAuth()
  const { toast }                    = useToast()
  const [local, setLocal]            = useState<UserPreferences>(defaultPreferences)
  const [isPending, setIsPending]    = useState(false)
  const initialized                  = useRef(false)

  useEffect(() => {
    if (!user || initialized.current) return
    setLocal(user.preferences)
    initialized.current = true
  }, [user])

  // Live theme preview
  useEffect(() => {
    const html = document.documentElement
    html.classList.forEach((cls) => { if (cls.startsWith('theme-')) html.classList.remove(cls) })
    html.classList.add(`theme-${local.theme}`)
  }, [local.theme])

  function set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setLocal((prev) => ({ ...prev, [key]: value }))
  }

  function reset() {
    initialized.current = false
    setLocal(user?.preferences ?? defaultPreferences)
    initialized.current = true
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsPending(true)
    try {
      await updatePreferences(local)
      toast.success('Preferências salvas com sucesso')
    } catch {
      toast.error('Erro ao salvar preferências. Tente novamente.')
    } finally {
      setIsPending(false)
    }
  }

  useTopbarActions(
    [{ label: isPending ? 'Gravando…' : 'Gravar', icon: Save, type: 'submit', form: FORM_ID, disabled: isPending, primary: true, keybind: 'ALT+G' }],
    [isPending],
  )

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar preferências', icon: Save, context: 'all', origin: 'preferences/page' })

  useShortcut('alt+v', () => router.push('/'), {
    desc: 'Voltar', icon: ArrowLeft, context: 'all', origin: 'preferences/page',
  })

  useShortcut('alt+l', reset, {
    display: false, origin: 'preferences/page',
  })

  return (
    <div className="p-6 max-w-3xl flex flex-col gap-8">
      <Breadcrumb segments={[{ label: 'Início', href: '/' }, { label: 'Preferências' }]} />

      <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-8">

        {/* Aparência */}
        <PrefsSection icon={Palette} label="Aparência">
          <div className={cn('px-4 py-4')}>
            <p className="text-sm font-medium mb-3">Tema</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {THEME_ORDER.map((name) => (
                <ThemeCard
                  key={name}
                  theme={name}
                  selected={local.theme === name}
                  onSelect={() => set('theme', name)}
                />
              ))}
            </div>
          </div>
        </PrefsSection>

        {/* Interface */}
        <PrefsSection icon={SlidersHorizontal} label="Interface">
          <PrefsRow
            label="Sidebar recolhida"
            description="Iniciar com a barra lateral em modo compacto"
          >
            <Switch
              checked={local.sidebarCollapsed}
              onToggle={() => set('sidebarCollapsed', !local.sidebarCollapsed)}
            />
          </PrefsRow>
        </PrefsSection>

        {/* Formato */}
        <PrefsSection icon={CalendarDays} label="Formato">
          <PrefsRow label="Data" description="Formato de exibição de datas em todo o sistema">
            <Select
              value={local.dateFormat}
              onChange={(e) => set('dateFormat', e.target.value as UserPreferences['dateFormat'])}
              wrapperClassName="w-44"
            >
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </Select>
          </PrefsRow>
        </PrefsSection>

      </form>
    </div>
  )
}
