'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Save, ArrowLeft, ChevronDown, Eye, EyeOff, Check } from 'lucide-react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { AutoBreadcrumb } from '@/core/AutoBreadcrumb'
import { useDiscovery } from '@/core/useDiscovery'
import { useTopbarActions } from '@/components/layout/topbar-actions-context'
import { useShortcut } from '@/lib/keywatch'
import { apiFetch } from '@/lib/auth'
import { Tabs } from '@/components/ui/tabs'
import { AssociationList, type BranchAssoc } from '@/components/ui/association-list'
import { CheckboxGroup, type CheckboxSection } from '@/components/ui/checkbox-group'
import { cn } from '@/lib/utils'
import type { PasswordPolicy } from '@nyx/schemas'

const FORM_ID  = 'user-form'
const inputBase = 'w-full border border-input rounded-sm px-3 py-2 text-sm bg-input-bg focus:outline-none focus:ring-1 focus:ring-ring'
const labelCls  = 'text-sm font-medium pt-2'
const gridCls   = 'grid gap-x-6 gap-y-3 md:grid-cols-[minmax(140px,max-content)_1fr] md:items-start'

interface FormValues {
  name:               string
  username:           string
  email:              string
  role:               string
  isActive:           boolean
  password:           string
  confirmPassword:    string
  newPassword:        string
  newConfirmPassword: string
}

// ---------------------------------------------------------------------------
// PolicyIndicator
// ---------------------------------------------------------------------------

function PolicyIndicator({
  password,
  policy,
}: {
  password: string
  policy:   PasswordPolicy | null | undefined
}) {
  if (!policy || !password) return null

  const checks = [
    { ok: password.length >= policy.minLength, label: `Mín. ${policy.minLength} caracteres` },
    ...(policy.requireUppercase ? [{ ok: /[A-Z]/.test(password), label: 'Letra maiúscula' }]  : []),
    ...(policy.requireNumbers   ? [{ ok: /[0-9]/.test(password), label: 'Número' }]            : []),
    ...(policy.requireSpecial   ? [{ ok: /[^A-Za-z0-9]/.test(password), label: 'Símbolo' }]   : []),
  ]

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
      {checks.map((c) => (
        <span
          key={c.label}
          className={cn(
            'flex items-center gap-1 text-xs transition-colors',
            c.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
          )}
        >
          <Check className={cn('w-3 h-3', !c.ok && 'opacity-30')} />
          {c.label}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PasswordInput
// ---------------------------------------------------------------------------

function PasswordInput({
  id,
  placeholder,
  register,
  error,
  autoFocus,
}: {
  id:          string
  placeholder?: string
  register:    UseFormRegisterReturn
  error?:      string
  autoFocus?:  boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cn(inputBase, 'pr-10')}
          {...register}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UserDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { id }   = params
  const router   = useRouter()
  const isNew    = id === 'new'

  const [isPending,    setIsPending]    = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [branches,     setBranches]     = useState<BranchAssoc[]>([])
  const [permissions,  setPermissions]  = useState<Set<string>>(new Set())

  const formInit       = useRef(false)
  const branchInit     = useRef(false)
  const permissionInit = useRef(false)

  const { data: discovery } = useDiscovery()

  // ── data fetching ──────────────────────────────────────────────────────────

  const { data: user } = useQuery({
    queryKey: ['core', 'user', id],
    queryFn:  async () => {
      const res = await apiFetch(`/core/user/${id}`)
      if (!res.ok) throw new Error('Failed to fetch user')
      return res.json() as Promise<Record<string, unknown>>
    },
    enabled:   !isNew,
    staleTime: 30_000,
  })

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
      password: '', confirmPassword: '',
      newPassword: '', newConfirmPassword: '',
    },
  })

  useEffect(() => {
    if (!user || formInit.current) return
    reset({
      name:     String(user.name     ?? ''),
      username: String(user.username ?? ''),
      email:    String(user.email    ?? ''),
      role:     String(user.role     ?? 'operator'),
      isActive: Boolean(user.isActive ?? true),
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

  useTopbarActions(
    [{ label: isPending ? 'Gravando…' : 'Gravar', icon: Save, type: 'submit', form: FORM_ID, disabled: isPending, primary: true }],
    [isPending],
  )

  useShortcut('alt+g', () => {
    (document.getElementById(FORM_ID) as HTMLFormElement | null)?.requestSubmit()
  }, { desc: 'Salvar registro', icon: Save, origin: 'apps/web/src/app/core/user/[id]/page', context: 'all' })

  useShortcut('alt+v', () => router.push('/core/user'), {
    desc: 'Voltar', icon: ArrowLeft,
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
          }),
        })
        if (!res.ok) throw new Error('Failed to create user')
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
        const calls: Promise<Response>[] = [
          apiFetch(`/core/user/${id}`, {
            method: 'PATCH',
            body:   JSON.stringify({
              name: data.name, username: data.username,
              email: data.email || null, role: data.role,
              isActive: data.isActive,
            }),
          }),
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
          calls.push(
            apiFetch(`/core/user/${id}/reset-password`, {
              method: 'PATCH',
              body:   JSON.stringify({ newPassword: data.newPassword }),
            }),
          )
        }

        await Promise.all(calls)
      }

      router.push('/core/user')
    } catch {
      setIsPending(false)
    }
  }

  // ── tabs content ───────────────────────────────────────────────────────────

  function renderDados() {
    return (
      <div className="space-y-6">
        <div className={gridCls}>
          <label htmlFor="name" className={labelCls}>Nome</label>
          <div className="space-y-1">
            <input
              id="name"
              autoFocus
              placeholder="Nome completo"
              className={inputBase}
              {...register('name', { required: 'Nome obrigatório' })}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <label htmlFor="username" className={labelCls}>Username</label>
          <div className="space-y-1">
            <input
              id="username"
              placeholder="Username"
              className={inputBase}
              {...register('username', { required: 'Username obrigatório' })}
            />
            {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
          </div>

          <label htmlFor="email" className={labelCls}>E-mail</label>
          <input
            id="email"
            type="email"
            placeholder="email@domain.com"
            className={inputBase}
            {...register('email')}
          />

          <label htmlFor="role" className={labelCls}>Perfil</label>
          <div className="relative w-full md:w-60">
            <select
              id="role"
              className={cn(inputBase, 'appearance-none pr-9')}
              {...register('role')}
            >
              <option value="admin">Admin</option>
              <option value="operator">Operador</option>
              <option value="viewer">Leitor</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>

          <div className="md:col-start-2 flex items-center gap-2 pt-1">
            <input id="isActive" type="checkbox" className="rounded" {...register('isActive')} />
            <label htmlFor="isActive" className="text-sm select-none cursor-pointer">Ativo</label>
          </div>
        </div>

        {/* password block */}
        {isNew ? (
          <div className="border-t border-border pt-5 space-y-4">
            <p className="text-sm font-medium text-foreground">Senha</p>
            <div className={gridCls}>
              <label htmlFor="password" className={labelCls}>Senha</label>
              <div className="space-y-1">
                <PasswordInput
                  id="password"
                  placeholder="Senha"
                  register={register('password', {
                    required: 'Senha obrigatória',
                    minLength: { value: 8, message: 'Mínimo 8 caracteres' },
                  })}
                  error={errors.password?.message}
                />
                <PolicyIndicator password={passwordValue} policy={policy} />
              </div>

              <label htmlFor="confirmPassword" className={labelCls}>Confirmar</label>
              <PasswordInput
                id="confirmPassword"
                placeholder="Confirmar senha"
                register={register('confirmPassword', {
                  required: 'Confirmação obrigatória',
                  validate:  (v) => v === passwordValue || 'As senhas não conferem',
                })}
                error={errors.confirmPassword?.message}
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
              <ChevronDown className={cn('w-4 h-4 transition-transform', passwordOpen && 'rotate-180')} />
              Redefinir senha
            </button>

            {passwordOpen && (
              <div className={cn(gridCls, 'mt-4')}>
                <label htmlFor="newPassword" className={labelCls}>Nova senha</label>
                <div className="space-y-1">
                  <PasswordInput
                    id="newPassword"
                    placeholder="Nova senha"
                    autoFocus
                    register={register('newPassword')}
                    error={errors.newPassword?.message}
                  />
                  <PolicyIndicator password={newPasswordValue} policy={policy} />
                </div>

                <label htmlFor="newConfirmPassword" className={labelCls}>Confirmar</label>
                <PasswordInput
                  id="newConfirmPassword"
                  placeholder="Confirmar nova senha"
                  register={register('newConfirmPassword', {
                    validate: (v) =>
                      !newPasswordValue || v === newPasswordValue || 'As senhas não conferem',
                  })}
                  error={errors.newConfirmPassword?.message}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      <AutoBreadcrumb domain="core" resource="user" id={id} recordName={recordName} />
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} autoComplete="off">
        <Tabs
          tabs={[
            { label: 'Dados',      content: renderDados() },
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
                <CheckboxGroup
                  sections={sections}
                  value={permissions}
                  onChange={setPermissions}
                />
              ),
            },
          ]}
        />
      </form>
    </div>
  )
}
