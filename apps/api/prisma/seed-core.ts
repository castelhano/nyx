import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

// ── companies ─────────────────────────────────────────────────────────────────

const COMPANIES: Array<{
  legalName: string; tradeName?: string; taxId: string
  address?: string; city?: string; state?: string; zipCode?: string
}> = [
  {
    tradeName: 'VPAR',
    legalName: 'VPAR TRANSPORTES E SERVICOS SPE LTDA',
    taxId:     '35.835.010',
    address:   'AVENIDA JOSE ESTEVAO TORQUATO DA SILVA NETO, 1.321, JD VITORIA',
    city:      'CUIABA',
    state:     'MT',
    zipCode:   '78.055-731',
  },
  {
    tradeName: 'RAPIDO',
    legalName: 'RAPIDO CUIABA TRANSPORTE URBANO LTDA',
    taxId:     '33.813.869',
    address:   'RUA OSLO (LOT RODOVIARIA PARQUE), NO 1',
    city:      'CUIABA',
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
    name:         'VP ROD PARQUE',
    taxId:        '35.835.010/0001-21',
    address:      'AVENIDA JOSE ESTEVAO TORQUATO DA SILVA NETO, 1.321, JD VITORIA',
    city:         'CUIABA',
    state:        'MT',
    zipCode:      '78.055-731',
  },
  {
    companyTaxId: '33.813.869',
    name:         'RC JD VITORIA',
    taxId:        '33.813.869/0001-04',
    address:      'RUA OSLO (LOT RODOVIARIA PARQUE), NO 1',
    city:         'CUIABA',
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
