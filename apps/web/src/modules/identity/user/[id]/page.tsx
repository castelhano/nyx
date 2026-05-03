'use client'

import { useRouter } from 'next/navigation'
import { AutoForm } from '@/core/AutoForm'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'

interface Props {
  params: { id: string }
}

export default function UserDetailPage({ params }: Props) {
  const router = useRouter()
  const isNew  = params.id === 'new'

  async function handleSubmit(data: Record<string, unknown>) {
    const url    = isNew ? `${API_BASE}/identity/users` : `${API_BASE}/identity/users/${params.id}`
    const method = isNew ? 'POST' : 'PATCH'
    await fetch(url, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') ?? ''}`,
      },
      body: JSON.stringify(data),
    })
    router.push('/identity/user')
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-semibold mb-4">{isNew ? 'New User' : 'Edit User'}</h1>
      <AutoForm domain="identity" resource="user" onSubmit={handleSubmit} />
    </div>
  )
}
