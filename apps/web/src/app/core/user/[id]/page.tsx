'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Icons } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PasswordInput } from '@/components/ui/password-input'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { KeyHint } from '@/core/FieldRenderer'
import { PolicyIndicator } from '@/core/PolicyIndicator'
import { usePageGuard } from '@/core/usePageGuard'
import { useRecordQuery } from '@/core/useRecordQuery'
import { useDiscovery } from '@/core/useDiscovery'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut, useFieldKeybinds } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { useToast } from '@/lib/toast-context'
import { useConfirm } from '@/lib/confirm-context'
import { msgs } from '@/lib/messages'
import { Tabs, type TabsHandle } from '@/components/ui/tabs'
import { AssociationList, type BranchAssoc } from '@/components/ui/association-list'
import { CheckboxGroup, type CheckboxSection } from '@/components/ui/checkbox-group'
import { cn, extractError } from '@/lib/utils'
import type { PasswordPolicy } from '@nyx/schemas'

const FORM_ID  = 'user-form'
const labelCls  = 'text-sm font-medium pt-2'
const gridCls   = 'grid gap-x-6 gap-y-3 md:grid-cols-[minmax(140px,max-content)_1fr] md:items-start'

interface FormValues {
  name:                string
  username:            string
  email:               string
  role:                string
  isActive:            boolean
  forcePasswordChange: boolean
  password:            string
  confirmPassword:     string
  newPassword:         string
  newConfirmPassword:  string
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UserDetailPage() {
  const { id }      = useParams<{ id: string }>()
  const router      = useRouter()
  const queryClient = useQueryClient()
  const isNew       = id === 'new'

  const [isPending,    setIsPending]    = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const { toast } = useToast()
  const confirm   = useConfirm()
  const [branches,     setBranches]     = useState<BranchAssoc[]>([])
  const [permissions,  setPermissions]  = useState<Set<string>>(new Set())

  const [copyOpen,     setCopyOpen]     = useState(false)
  const [copySearch,   setCopySearch]   = useState('')
  const [copyUser,     setCopyUser]     = useState<{ id: string; name: string; username: string } | null>(null)
  const [copyDomains,  setCopyDomains]  = useState<Set<string>>(new Set())
  const [copyPending,  setCopyPending]  = useState(false)
  const [copyListOpen, setCopyListOpen] = useState(false)

  const formInit       = useRef(false)
  const branchInit     = useRef(false)
  const permissionInit = useRef(false)
  const copyComboRef   = useRef<HTMLDivElement>(null)
  const tabsRef        = useRef<TabsHandle>(null)

  // ── data fetching ──────────────────────────────────────────────────────────

  const { data: user, error: userError } = useRecordQuery(
    ['core', 'user', id],
    `/core/user/${id}`,
    { enabled: !isNew, staleTime: 30_000 },
  )

  const { guardNode, canCreate, canUpdate, canDelete, meta } = usePageGuard('core', 'user', isNew, userError ?? undefined)

  const f   = (name: string) => meta?.fields.find((f) => f.name === name)
  const kb  = (name: string) => f(name)?.keybind     ?? ''
  const lbl = (name: string) => f(name)?.label       ?? name
  const ph  = (name: string) => f(name)?.placeholder ?? ''
  const cls = (name: string) => f(name)?.className   ?? ''
  const hlp = (name: string) => f(name)?.helpText    ?? ''
  const { data: discovery } = useDiscovery()

  const { data: allBranches } = useQuery({
    queryKey: ['core', 'branch', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/branch?pageSize=999')
      if (!res.ok) throw new Error('Failed to fetch branches')
      const json = await res.json()
      return (json.data ?? []) as { id: string; name: string; companyId: string }[]
    },
    staleTime: 60_000,
  })

  const { data: allCompanies } = useQuery({
    queryKey: ['core', 'company', 'all'],
    queryFn:  async () => {
      const res = await apiFetch('/core/company?pageSize=999')
      if (!res.ok) throw new Error('Failed to fetch companies')
      const json = await res.json()
      return (json.data ?? []) as { id: string; legalName: string }[]
    },
    staleTime: 60_000,
  })

  const { data: userBranches } = useQuery({
    queryKey: ['core', 'user-branch', 'by-user', id],
    queryFn:  async () => {
      const res = await apiFetch(`/core/user-branch/by-user/${id}`)
      if (!res.ok) throw new Error('Failed to fetch user branches')
      return res.json() as Promise<{ branchId: string; role: string }[]>
    },
    enabled:   !isNew,
    staleTime: 30_000,
  })

  const { data: userPerms } = useQuery({
    queryKey: ['core', 'user-permission', 'by-user', id],
    queryFn:  async () => {
      const res = await apiFetch(`/core/user-permission/by-user/${id}`)
      if (!res.ok) throw new Error('Failed to fetch user permissions')
      return res.json() as Promise<{ resource: string; action: string }[]>
    },
    enabled:   !isNew,
    staleTime: 30_000,
  })

  const { data: copyUserResults = [] } = useQuery<{ id: string; name: string; username: string }[]>({
    queryKey: ['core', 'user', 'search', copySearch],
    queryFn:  async () => {
      const params = new URLSearchParams({ search: copySearch, pageSize: '10' })
      const res = await apiFetch(`/core/user?${params}`)
      if (!res.ok) return []
      const json = await res.json()
      return (json.data ?? []).filter((u: { id: string }) => u.id !== id)
    },
    enabled:   copyOpen && copyListOpen && copySearch.length >= 2,
    staleTime: 10_000,
  })

  const { data: policy } = useQuery<PasswordPolicy | null>({
    queryKey: ['core', 'password-policy'],
    queryFn:  async () => {
      const res = await apiFetch('/core/password-policy')
      if (!res.ok) return null
      const json = await res.json()
      return (json.data?.[0] ?? null) as PasswordPolicy | null
    },
    staleTime: 300_000,
  })

  // ── form ───────────────────────────────────────────────────────────────────

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      name: '', username: '', email: '', role: 'operator', isActive: true,
      forcePasswordChange: true,
      password: '', confirmPassword: '',
      newPassword: '', newConfirmPassword: '',
    },
  })

  useEffect(() => {
    if (!user || formInit.current) return
    reset({
      name:                String(user.name     ?? ''),
      username:            String(user.username ?? ''),
      email:               String(user.email    ?? ''),
      role:                String(user.role     ?? 'operator'),
      isActive:            Boolean(user.isActive            ?? true),
      forcePasswordChange: Boolean(user.forcePasswordChange ?? false),
      password: '', confirmPassword: '',
      newPassword: '', newConfirmPassword: '',
    })
    formInit.current = true
  }, [user, reset])

  useEffect(() => {
    if (!userBranches || branchInit.current) return
    setBranches(userBranches.map((b) => ({ branchId: b.branchId, role: b.role })))
    branchInit.current = true
  }, [userBranches])

  useEffect(() => {
    if (!userPerms || permissionInit.current) return
    setPermissions(new Set(userPerms.map((p) => `${p.resource}:${p.action}`)))
    permissionInit.current = true
  }, [userPerms])

  useEffect(() => {
    if (!copyListOpen) return
    function onOutside(e: MouseEvent) {
      if (copyComboRef.current && !copyComboRef.current.contains(e.target as Node)) {
        setCopyListOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [copyListOpen])

  async function handleCopy() {
    if (!copyUser || !copyDomains.size) return
    setCopyPending(true)
    try {
      const res = await apiFetch(`/core/user-permission/by-user/${copyUser.id}`)
      if (!res.ok) return
      const sourcePerms = await res.json() as { resource: string; action: string }[]

      const selectedResources = new Set<string>()
      for (const domain of (discovery ?? [])) {
        if (copyDomains.has(domain.key)) {
          for (const r of domain.resources) selectedResources.add(r.key)
        }
      }

      const kept   = Array.from(permissions).filter(p => !selectedResources.has(p.split(':')[0]))
      const copied = sourcePerms
        .filter(p => selectedResources.has(p.resource))
        .map(p => `${p.resource}:${p.action}`)

      setPermissions(new Set([...kept, ...copied]))
      setCopyOpen(false)
      setCopyUser(null)
      setCopySearch('')
      setCopyDomains(new Set())
    } finally {
      setCopyPending(false)
    }
  }

  const passwordValue    = watch('password')
  const newPasswordValue = watch('newPassword')
  const recordName       = user ? String(user.name ?? '') : undefined

  const sections: CheckboxSection[] = useMemo(
    () =>
      (discovery ?? []).map((domain) => ({
        key:       domain.key,
        label:     domain.label,
        resources: domain.resources.map((r) => ({ key: r.key, label: r.labelPlural })),
      })),
    [discovery],
  )

  // ── topbar & shortcuts ─────────────────────────────────────────────────────

  async function handleDelete() {
    const ok = await confirm({ title: 'Excluir usuário?' })
    if (!ok) return
    setIsPending(true)
    try {
      const res = await apiFetch(`/core/user/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success(msgs.deleted())
      router.push('/core/user')
    } catch {
      toast.error(msgs.error.delete())
      setIsPending(false)
    }
  }

  useTopbarActions([
    ...((isNew ? canCreate : canUpdate) ? [{ label: isPending ? 'Gravando…' : 'Gravar', icon: Icons.Save, type: 'submit' as const, form: FORM_ID, disabled: isPending, primary: true }] : []),
    ...(!isNew && canDelete ? [{ label: 'Excluir', icon: Icons.Trash2, variant: 'destructive' as const, onClick: handleDelete, disabled: isPending }] : []),
  ], [isPending, isNew, canCreate, canUpdate, canDelete])

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar registro', icon: Icons.Save, origin: 'apps/web/src/app/core/user/[id]/page', context: 'all' })

  useShortcut('alt+l', () => {
    if (user) {
      reset({
        name:                String(user.name     ?? ''),
        username:            String(user.username ?? ''),
        email:               String(user.email    ?? ''),
        role:                String(user.role     ?? 'operator'),
        isActive:            Boolean(user.isActive            ?? true),
        forcePasswordChange: Boolean(user.forcePasswordChange ?? false),
        password: '', confirmPassword: '',
        newPassword: '', newConfirmPassword: '',
      })
    }
    if (userBranches) setBranches(userBranches.map((b) => ({ branchId: b.branchId, role: b.role })))
    if (userPerms)    setPermissions(new Set(userPerms.map((p) => `${p.resource}:${p.action}`)))
    setPasswordOpen(false)
    setCopyOpen(false)
    setCopyUser(null)
    setCopySearch('')
    setCopyDomains(new Set())
  }, { display: false, origin: 'apps/web/src/app/core/user/[id]/page' })

  useFieldKeybinds(
    (['name', 'username', 'email', 'role', 'password'] as const)
      .map(f => ({ key: kb(f), fieldId: f, tabIndex: 0 }))
      .filter(b => !!b.key),
    'core/user/[id]',
    tabsRef,
  )

  useShortcut('alt+v', () => router.push('/core/user'), {
    desc: 'Voltar', icon: Icons.ArrowLeft,
    origin: 'apps/web/src/app/core/user/[id]/page', context: 'all',
  })

  // ── submit ─────────────────────────────────────────────────────────────────

  async function onSubmit(data: FormValues) {
    setIsPending(true)
    try {
      const permissionList = Array.from(permissions).map((k) => {
        const [resource, action] = k.split(':')
        return { resource, action }
      })

      if (isNew) {
        const res = await apiFetch('/core/user', {
          method: 'POST',
          body:   JSON.stringify({
            name: data.name, username: data.username,
            email: data.email || null, role: data.role,
            isActive: data.isActive, password: data.password,
            forcePasswordChange: data.forcePasswordChange,
          }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(extractError(json))
        }
        const newUser = await res.json() as { id: string }
        await Promise.all([
          apiFetch(`/core/user-branch/by-user/${newUser.id}`, {
            method: 'PUT',
            body:   JSON.stringify({ branches }),
          }),
          apiFetch(`/core/user-permission/by-user/${newUser.id}`, {
            method: 'PUT',
            body:   JSON.stringify({ permissions: permissionList }),
          }),
        ])
      } else {
        const userRes = await apiFetch(`/core/user/${id}`, {
          method: 'PATCH',
          body:   JSON.stringify({
            name: data.name, username: data.username,
            email: data.email || null, role: data.role,
            isActive: data.isActive,
            forcePasswordChange: data.forcePasswordChange,
          }),
        })
        if (!userRes.ok) {
          const json = await userRes.json().catch(() => ({}))
          throw new Error(extractError(json))
        }

        const sideCalls: Promise<Response>[] = [
          apiFetch(`/core/user-branch/by-user/${id}`, {
            method: 'PUT',
            body:   JSON.stringify({ branches }),
          }),
          apiFetch(`/core/user-permission/by-user/${id}`, {
            method: 'PUT',
            body:   JSON.stringify({ permissions: permissionList }),
          }),
        ]

        if (passwordOpen && data.newPassword) {
          sideCalls.push(
            apiFetch(`/core/user/${id}/reset-password`, {
              method: 'PATCH',
              body:   JSON.stringify({ newPassword: data.newPassword }),
            }),
          )
        }

        await Promise.all(sideCalls)
      }

      await queryClient.invalidateQueries({ queryKey: ['core', 'user-branch', 'by-user', id] })
      await queryClient.invalidateQueries({ queryKey: ['core', 'user-permission', 'by-user', id] })
      await queryClient.invalidateQueries({ queryKey: ['core', 'user', id] })
      toast.success(isNew ? msgs.created() : msgs.updated())
      router.push('/core/user')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : msgs.error.save())
      setIsPending(false)
    }
  }

  // ── tabs content ───────────────────────────────────────────────────────────

  function renderDados() {
    return (
      <div className="space-y-6">
        <div className={gridCls}>
          <label htmlFor="name" className={labelCls}>{lbl('name')}</label>
          <div className="space-y-1">
            <div className="relative">
              <Input
                id="name"
                autoFocus
                placeholder={ph('name')}
                className="w-full md:pr-10"
                {...register('name', { required: `${lbl('name')} obrigatório` })}
              />
              {kb('name') && <KeyHint k={kb('name')} />}
            </div>
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <label htmlFor="username" className={labelCls}>{lbl('username')}</label>
          <div className="space-y-1">
            <div className={cn('relative', cls('username'))}>
              <Input
                id="username"
                placeholder={ph('username')}
                className="w-full md:pr-10"
                {...register('username', { required: `${lbl('username')} obrigatório` })}
              />
              {kb('username') && <KeyHint k={kb('username')} />}
            </div>
            {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
          </div>

          <label htmlFor="email" className={labelCls}>{lbl('email')}</label>
          <div className={cn('relative', cls('email'))}>
            <Input
              id="email"
              type="email"
              placeholder={ph('email')}
              className="w-full md:pr-10"
              {...register('email')}
            />
            {kb('email') && <KeyHint k={kb('email')} />}
          </div>

          <label htmlFor="role" className={labelCls}>{lbl('role')}</label>
          <Select id="role" wrapperClassName={cls('role')} keybind={kb('role')} {...register('role')}>
            <option value="admin">{lbl('role')} - Admin</option>
            <option value="operator">{lbl('role')} - Operador</option>
          </Select>

          <div className="md:col-start-2 flex items-center gap-2 pt-1">
            <input id="isActive" type="checkbox" className="rounded" {...register('isActive')} />
            <label htmlFor="isActive" className="text-sm select-none cursor-pointer">{lbl('isActive')}</label>
          </div>

          <div className="md:col-start-2 flex items-center gap-2">
            <input id="forcePasswordChange" type="checkbox" className="rounded" {...register('forcePasswordChange')} />
            <label htmlFor="forcePasswordChange" className="text-sm select-none cursor-pointer">{lbl('forcePasswordChange')}</label>
          </div>
        </div>

        {/* password block */}
        {isNew ? (
          <div className="border-t border-border pt-5 space-y-4">
            <p className="text-sm font-medium text-foreground">Dados de acesso</p>
            <div className={cn(gridCls, 'md:w-1/3')}>
              <label htmlFor="password" className={labelCls}>Senha</label>
              <div className="space-y-1">
                <PasswordInput
                  id="password"
                  placeholder="Senha"
                  error={errors.password?.message}
                  className="w-full"
                  keybind={kb('password')}
                  {...register('password', { required: `${lbl('password')} obrigatória` })}
                />
                <PolicyIndicator password={passwordValue} policy={policy} />
              </div>

              <label htmlFor="confirmPassword" className={labelCls}>Confirmar</label>
              <PasswordInput
                id="confirmPassword"
                placeholder="Confirmar senha"
                error={errors.confirmPassword?.message}
                className="w-full"
                {...register('confirmPassword', {
                  required: 'Confirmação obrigatória',
                  validate:  (v) => v === passwordValue || 'As senhas não conferem',
                })}
              />
            </div>
          </div>
        ) : (
          <div className="border-t border-border pt-5">
            <button
              type="button"
              onClick={() => setPasswordOpen((v) => !v)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icons.ChevronDown className={cn('w-4 h-4 transition-transform', passwordOpen && 'rotate-180')} />
              Redefinir senha
            </button>

            {passwordOpen && (
              <div className={cn(gridCls, 'mt-4 md:w-1/3')}>
                <label htmlFor="newPassword" className={labelCls}>Nova senha</label>
                <div className="space-y-1">
                  <PasswordInput
                    id="newPassword"
                    placeholder="Nova senha"
                    autoFocus
                    error={errors.newPassword?.message}
                    className="w-full"
                    {...register('newPassword')}
                  />
                  <PolicyIndicator password={newPasswordValue} policy={policy} />
                </div>

                <label htmlFor="newConfirmPassword" className={labelCls}>Confirmar</label>
                <PasswordInput
                  id="newConfirmPassword"
                  placeholder="Confirmar nova senha"
                  error={errors.newConfirmPassword?.message}
                  className="w-full"
                  {...register('newConfirmPassword', {
                    validate: (v) =>
                      !newPasswordValue || v === newPasswordValue || 'As senhas não conferem',
                  })}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (guardNode) return guardNode

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="core" resource="user" id={id} recordName={recordName} />
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} autoComplete="off">
        <Tabs
          ref={tabsRef}
          tabs={[
            {
            label:      'Dados',
            content:    renderDados(),
            errorCount: (
              ['name', 'username', 'email', 'password', 'confirmPassword', 'newPassword', 'newConfirmPassword'] as const
            ).filter((f) => errors[f]).length || undefined,
          },
            {
              label: 'Filiais',
              content: (
                <AssociationList
                  items={branches}
                  onChange={setBranches}
                  branches={allBranches ?? []}
                  companies={(allCompanies ?? []).map((c) => ({ id: c.id, name: c.legalName }))}
                />
              ),
            },
            {
              label: 'Permissões',
              content: (
                <div>
                  <div className="p-3 mb-4 bg-muted rounded">
                    <button
                      type="button"
                      onClick={() => setCopyOpen((v) => !v)}
                      className="flex items-center gap-2 text-sm w-full py-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      <Icons.ChevronDown className={cn('w-4 h-4 transition-transform', copyOpen && 'rotate-180')} />
                      Copiar permissões
                    </button>

                    {copyOpen && (
                      <div className="mt-4 space-y-4">

                        {/* User search combobox */}
                        <div className="space-y-1.5">
                          <p className="text-sm font-medium">Usuário de origem</p>
                          <div className="relative w-full md:w-96" ref={copyComboRef}>
                            <Input
                              size="sm"
                              placeholder="Buscar por nome ou username…"
                              value={copyUser ? copyUser.name : copySearch}
                              onChange={(e) => {
                                setCopySearch(e.target.value)
                                setCopyUser(null)
                                setCopyListOpen(true)
                              }}
                              onFocus={() => { if (copySearch.length >= 2) setCopyListOpen(true) }}
                              className="w-full"
                            />
                            {copyListOpen && copyUserResults.length > 0 && (
                              <div className="absolute left-0 top-full mt-1 z-50 w-full bg-card border border-border rounded-(--radius) shadow-md py-1">
                                {copyUserResults.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                                    onMouseDown={(e) => {
                                      e.preventDefault()
                                      setCopyUser(u)
                                      setCopySearch(u.name)
                                      setCopyListOpen(false)
                                    }}
                                  >
                                    <span className="font-medium">{u.name}</span>
                                    <span className="text-muted-foreground ml-2 text-xs">{u.username}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Domain selection */}
                        {copyUser && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Domínios</p>
                            <div className="flex flex-wrap gap-x-6 gap-y-2">
                              {(discovery ?? []).map((domain) => (
                                <label key={domain.key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    className="rounded"
                                    checked={copyDomains.has(domain.key)}
                                    onChange={(e) => {
                                      setCopyDomains((prev) => {
                                        const next = new Set(prev)
                                        e.target.checked ? next.add(domain.key) : next.delete(domain.key)
                                        return next
                                      })
                                    }}
                                  />
                                  {domain.label}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Copy button */}
                        {copyUser && copyDomains.size > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCopy}
                            disabled={copyPending}
                          >
                            <Icons.Copy className="w-3.5 h-3.5" />
                            {copyPending ? 'Copiando…' : 'Copiar permissões'}
                          </Button>
                        )}

                      </div>
                    )}
                  </div>

                  <CheckboxGroup
                    sections={sections}
                    value={permissions}
                    onChange={setPermissions}
                  />

                </div>
              ),
            },
          ]}
        />
      </form>
    </div>
  )
}
