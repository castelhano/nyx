'use client'

import { useRouter } from 'next/navigation'
import { AutoList } from '@/core/AutoList'

export default function CompanyListPage() {
  const router = useRouter()
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Companies</h1>
        <button
          onClick={() => router.push('/crm/company/new')}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          New Company
        </button>
      </div>
      <AutoList domain="crm" resource="company" onEdit={(id) => router.push(`/crm/company/${id}`)} />
    </div>
  )
}
