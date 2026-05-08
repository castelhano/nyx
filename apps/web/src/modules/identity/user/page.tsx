'use client'

import { useRouter } from 'next/navigation'
import { AutoList } from '@/core/AutoList'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default function UserListPage() {
  const router = useRouter()
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Users</h1>
        <Button onClick={() => router.push('/identity/user/new')} size='sm'>
          <Plus className='w-4 h-4' />
        </Button>
      </div>
      <AutoList domain="identity" resource="user" onEdit={(id) => router.push(`/identity/user/${id}`)} />
    </div>
  )
}
