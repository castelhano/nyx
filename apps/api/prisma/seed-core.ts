import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaPg } from '@prisma/adapter-pg'

const url      = process.env.DATABASE_URL!
const adapter  = url.startsWith('postgresql://') || url.startsWith('postgres://')
  ? new PrismaPg({ connectionString: url })
  : new PrismaLibSql({ url })
const prisma   = new PrismaClient({ adapter })

// ── companies ─────────────────────────────────────────────────────────────────

const COMPANIES: Array<{
  legalName: string; tradeName?: string; taxId: string
  address?: string; city?: string; state?: string; zipCode?: string
}> = [
  {
    tradeName: 'VPAR',
    legalName: 'Vpar Transportes e Servicos SPE LTDA',
    taxId:     '35.835.010',
    address:   'Avenida Jose Estevao Torquato da Silva Neto, 1.321, Jd Vitoria',
    city:      'Cuiaba',
    state:     'MT',
    zipCode:   '78.055-731',
  },
  {
    tradeName: 'RAPIDO',
    legalName: 'Rapido Cuiaba Transporte Urbano LTDA',
    taxId:     '33.813.869',
    address:   'Rua Oslo (Lot Rodoviaria Parque), No 1',
    city:      'Cuiaba',
    state:     'MT',
    zipCode:   '78.048-110',
  },
]

// ── branches ──────────────────────────────────────────────────────────────────

const BRANCHES: Array<{
  companyTaxId: string; name: string; taxId?: string
  address?: string; city?: string; state?: string; zipCode?: string
}> = [
  {
    companyTaxId: '35.835.010',
    name:         'VP Rod Parque',
    taxId:        '35.835.010/0001-21',
    address:      'Avenida Jose Estevao Torquato da Silva Neto, 1.321, Jd Vitoria',
    city:         'Cuiaba',
    state:        'MT',
    zipCode:      '78.055-731',
  },
  {
    companyTaxId: '33.813.869',
    name:         'RC Jd Vitoria',
    taxId:        '33.813.869/0001-04',
    address:      'Rua Oslo (Lot Roroviaria Parque), No 1',
    city:         'Cuiaba',
    state:        'MT',
    zipCode:      '78.048-110',
  },
]

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding core data…')

  // ── companies ───────────────────────────────────────────────────────────────

  const companyMap = new Map<string, string>()
  for (const c of COMPANIES) {
    const record = await prisma.company.upsert({
      where:  { taxId: c.taxId },
      update: { legalName: c.legalName, tradeName: c.tradeName, address: c.address, city: c.city, state: c.state, zipCode: c.zipCode },
      create: { legalName: c.legalName, tradeName: c.tradeName, taxId: c.taxId, address: c.address, city: c.city, state: c.state, zipCode: c.zipCode },
    })
    companyMap.set(c.taxId, record.id)
  }
  console.log(`  ✓ companies (${COMPANIES.length})`)

  // ── branches ─────────────────────────────────────────────────────────────────

  for (const b of BRANCHES) {
    const companyId = companyMap.get(b.companyTaxId)!
    await prisma.branch.upsert({
      where:  { taxId: b.taxId },
      update: { name: b.name, address: b.address, city: b.city, state: b.state, zipCode: b.zipCode },
      create: { companyId, name: b.name, taxId: b.taxId, address: b.address, city: b.city, state: b.state, zipCode: b.zipCode },
    })
  }
  console.log(`  ✓ branches (${BRANCHES.length})`)

  console.log('Core seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
