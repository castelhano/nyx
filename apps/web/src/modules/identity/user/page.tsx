'use client'

import { useRouter } from 'next/navigation'
import { AutoList } from '@/core/AutoList'

export default function UserListPage() {
  const router = useRouter()
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Users</h1>
        <button
          onClick={() => router.push('/identity/user/new')}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          New User
        </button>
      </div>
      <AutoList domain="identity" resource="user" onEdit={(id) => router.push(`/identity/user/${id}`)} />
    </div>
  )
}
