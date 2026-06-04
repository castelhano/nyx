import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL! })
const prisma  = new PrismaClient({ adapter })

// ── localities ────────────────────────────────────────────────────────────────

const LOCALITIES: Array<{
  code: string; name: string; abbr?: string
  lat?: number; lng?: number; isDepot?: boolean
}> = [
  { code: '1000', name: 'Term Antartica',   abbr: 'AMBEV',  lat: -15.56637,           lng: -56.12806            },
  { code: '1001', name: 'Est Alencastro',   abbr: 'ALENC',  lat: -15.597321,          lng: -56.096074           },
  { code: '1002', name: 'Sta Amalia',       abbr: 'AMALIA', lat: -15.591231,          lng: -56.130917           },
  { code: '1003', name: 'Term Cpa 1',       abbr: 'CPA 1',  lat: -15.55705,           lng: -56.05106            },
  { code: '1004', name: 'Mika',             abbr: 'MIKA',   lat: -15.52648,           lng: -56.112916           },
  { code: '1005', name: 'Matriz',           abbr: 'MATRIZ', lat: -15.597364,          lng: -56.096352           },
  { code: '1006', name: 'Ubirajara',        abbr: 'UBIRAJ', lat: -15.558122485929400,  lng: -56.09138862876930  },
  { code: '1007', name: 'Detran',           abbr: 'DETRAN', lat: -15.5618,            lng: -56.07203            },
  { code: '1008', name: 'Florianopolis',    abbr: 'FLORIA', lat: -15.54212132013890,  lng: -56.07831536850770   },
  { code: '1009', name: 'Est Bispo A',      abbr: 'BISPO',  lat: -15.599964,          lng: -56.095614           },
  { code: '1010', name: 'Rod Parque',       abbr: 'ROD PQ', lat: -15.575109318281600, lng: -56.091105937957700  },
  { code: '1011', name: 'Hmc',              abbr: 'HMC',    lat: -15.56280480784740,  lng: -56.10732912756040   },
  { code: '1012', name: 'Jd Vitoria',       abbr: 'VITORI', lat: -15.536174,          lng: -56.073334           },
  { code: '1013', name: 'Est Ipiranga',     abbr: 'IPIRAN', lat: -15.601199417220400, lng: -56.09713286161420   },
  { code: '1014', name: 'Vila Serra',       abbr: 'V SERR', lat: -15.540779197457400, lng: -56.042150259017900  },
  { code: '1015', name: 'Term Cpa 3',       abbr: 'CPA 3',  lat: -15.574267025001200, lng: -56.03433966636650   },
  { code: '1016', name: 'Grde Terceiro',    abbr: 'GRD 3o', lat: -15.62611,           lng: -56.08294            },
  { code: '1017', name: 'Cr D Aquino',      abbr: 'CRD AQ', lat: -15.606722,          lng: -56.105068           },
  { code: '1018', name: 'Ufmt',             abbr: 'UFMT',   lat: -15.613721,          lng: -56.072768           },
  { code: '1019', name: 'Res Picolli',      abbr: 'PICOLL', lat: -15.53738,           lng: -56.0326             },
  { code: '1020', name: 'Praeiro',          abbr: 'PRAEIR', lat: -15.630071,          lng: -56.07448            },
  { code: '1021', name: 'Correios 13',      abbr: 'CORREI', lat: -15.598464,          lng: -56.095593           },
  { code: '1022', name: 'Guia',             abbr: 'GUIA',   lat: -15.344191129981700, lng: -56.2329985716251    },
  { code: '1023', name: 'Pq Nacoes',        abbr: 'PQ NAC', lat: -15.54627302172870,  lng: -56.08394980430600   },
  { code: '1024', name: 'S Dourada',        abbr: 'S DOUR', lat: -15.547558,          lng: -56.046141           },
  { code: '1025', name: 'Dr Fabio',         abbr: 'DR FAB', lat: -15.565110562266500, lng: -56.01223977471680   },
  { code: '1026', name: 'Ilza Terezinha',   abbr: 'I TERE', lat: -15.538113305223300, lng: -56.02964249426750   },
  { code: '1027', name: 'Planalto',         abbr: 'PLANAL', lat: -15.585136480922200, lng: -56.03605977652890   },
  { code: '1028', name: 'Bandeira',         abbr: 'BANDEI', lat: -15.5099055,         lng: -56.174546           },
  { code: '1029', name: 'Sucuri',           abbr: 'SUCURI', lat: -15.547571,          lng: -56.157053           },
  { code: '1030', name: 'Vila Jardim',      abbr: 'V JARD', lat: -15.547571,          lng: -56.157053           },
  { code: '1031', name: 'Florais Italia',   abbr: 'F ITAL', lat: -15.60498,           lng: -56.02053            },
  { code: '1032', name: 'Comper Trab',      abbr: 'COMPER', lat: -15.589219,          lng: -56.060484           },
  { code: '1033', name: 'Coxipo Ouro',      abbr: 'COXIPO', lat: -15.458186357528200, lng: -55.978863952783600  },
  { code: '1034', name: 'Aguacu',           abbr: 'AGUACU', lat: -15.278967681551400, lng: -56.12290340530900   },
]

// ── day types ─────────────────────────────────────────────────────────────────

const DAY_TYPES: Array<{ code: string; name: string; pattern?: object; priority: number; sortOrder: number }> = [
  { code: 'U', name: 'UTIL',     pattern: { type: 'weekdays', days: [1,2,3,4,5] }, priority: 1, sortOrder: 1 },
  { code: 'S', name: 'SABADO',   pattern: { type: 'weekdays', days: [6] },          priority: 1, sortOrder: 2 },
  { code: 'D', name: 'DOMINGO',  pattern: { type: 'weekdays', days: [7] },          priority: 1, sortOrder: 3 },
  { code: 'F', name: 'FERIAS',                                                       priority: 3, sortOrder: 4 },
  { code: 'E', name: 'ESPECIAL',                                                     priority: 3, sortOrder: 5 },
]

// ── lines ─────────────────────────────────────────────────────────────────────

const LINES: Array<{ code: string; name: string; type: string; metrics?: object }> = [
  { code: '31',   name: 'Corujao Cpa 4 x Centro',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 13.1,       INBOUND: 13.1       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 40  }] } },
  { code: '32',   name: 'Jd Vitoria x Coopamil',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 13.85,      INBOUND: 13.85      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 40  }] } },
  { code: '33',   name: 'Jd Vitoria x Pq Cuiaba',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 33.2,       INBOUND: 33.2       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 40  }] } },
  { code: '34',   name: 'Jd Vitoria x Pedra 90',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 38.85,      INBOUND: 38.85      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 40  }] } },
  { code: '105',  name: 'Santa Marta x Centro',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 27.45,      INBOUND: 27.45      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 200 }] } },
  { code: '107',  name: 'Santa Amalia x T Cpa I',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 38,         INBOUND: 38         }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 288 }] } },
  { code: '203',  name: 'Vale Dos Lirios x Centro',        type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 18.25,      INBOUND: 18.25      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 110 }] } },
  { code: '204',  name: 'B Da Chapada x Centro',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 9.995,      INBOUND: 9.995      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 80  }] } },
  { code: '205',  name: 'Respaiaguas x Centro',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 11.9,       INBOUND: 11.9       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 84  }] } },
  { code: '206',  name: 'Cpa1 x Centro',                   type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 16.5,       INBOUND: 16.5       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 126 }] } },
  { code: '213',  name: 'Tres Poderes x Centro',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 14.05,      INBOUND: 14.05      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 96  }] } },
  { code: '225',  name: 'Altos Da Boa Vista x Centro',     type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 7.955,      INBOUND: 7.955      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 64  }] } },
  { code: '250',  name: 'T Antartica x Centro',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 10.85,      INBOUND: 10.85      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 84  }] } },
  { code: '251',  name: 'Pronto Socorro x Alencastro',     type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 6.75,       INBOUND: 6.75       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 66  }] } },
  { code: '301',  name: 'Jd Vitoria x Centro',             type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 11.3,       INBOUND: 11.3       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 99  }] } },
  { code: '302',  name: 'Vila Da Serra x Centro',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 15.95,      INBOUND: 15.95      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 132 }] } },
  { code: '306',  name: 'Term Cpa 3 x G Terceiro',         type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 12.2,       INBOUND: 12.2       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 90  }] } },
  { code: '308',  name: 'Term Cpa 3 x Rib Do Lipa',        type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 21.73,      INBOUND: 21.73      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 320 }] } },
  { code: '309',  name: '1o De Marco x Centro',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 21.6,       INBOUND: 21.6       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 144 }] } },
  { code: '310',  name: 'Term Cpa Iii x Centro',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 9.64,       INBOUND: 9.64       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 75  }] } },
  { code: '311',  name: 'N Mato Grosso x Centro',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 13.9,       INBOUND: 13.9       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 130 }] } },
  { code: '313',  name: 'Term Cpa 3 x Fiemtec',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 15.55,      INBOUND: 15.55      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 132 }] } },
  { code: '319',  name: 'Tres Barras x Porto',             type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 16.995,     INBOUND: 16.995     }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 165 }] } },
  { code: '323',  name: 'Ter Cpa I x Crd Aquino',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 16.4,       INBOUND: 16.4       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 176 }] } },
  { code: '330',  name: 'Ter Cpa I x Ufmt',                type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 13.115,     INBOUND: 13.115     }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 95  }] } },
  { code: '340',  name: 'A Da Gloria x Centro',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 15.25,      INBOUND: 15.25      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 130 }] } },
  { code: '380',  name: 'Term Cpa 1 x Estacao Shopp',      type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 17.2,       INBOUND: 17.2       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 88  }] } },
  { code: '390',  name: 'Res Picolli x Centro',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 16.75,      INBOUND: 16.75      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 88  }] } },
  { code: '409',  name: 'Praeiro x Centro',                type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 6.55,       INBOUND: 6.55       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 66  }] } },
  { code: '410',  name: 'Sta Rosa x Gde Terceiro',         type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 10.46,      INBOUND: 10.46      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 99  }] } },
  { code: '721',  name: 'Volunt Patria x Shopp Pantanal',  type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 24.6585,    INBOUND: 24.6585    }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 140 }] } },
  { code: '800',  name: 'Dist Da Guia x Centro',           type: 'RURAL',        metrics: { extensionKm: { OUTBOUND: 37.8,       INBOUND: 37.8       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 150 }] } },
  { code: '206B', name: 'Florianopolis x Centro',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 11.65,      INBOUND: 11.65      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 54  }] } },
  { code: '308B', name: 'Term Cpa 3 x Alencastro',         type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 10.41,      INBOUND: 10.41      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 80  }] } },
  { code: '309B', name: 'Term Cpa 3 x Centro',             type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 10.9,       INBOUND: 10.9       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 65  }] } },
  { code: '311B', name: 'N Mato Grosso (v Alice Freire)',  type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 14.6,       INBOUND: 14.6       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 130 }] } },
  { code: 'A02',  name: 'Alim Cpa 1 x B Branco',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 8.576,      INBOUND: 8.576      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 56  }] } },
  { code: 'A06',  name: 'Alim Cpa 1 x Gamaliel',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 14.3,       INBOUND: 14.3       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 95  }] } },
  { code: 'A06B', name: 'Alim Cpa 1 x A Da Gloria',        type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 7.3,        INBOUND: 7.3        }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 60  }] } },
  { code: 'A07',  name: 'Alim Cpa 1 x S Dourada',          type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 7.8,        INBOUND: 7.8        }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 90  }] } },
  { code: 'A08',  name: 'Alim Cpa 1 x 1o De Marco',        type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 8.4,        INBOUND: 8.4        }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 60  }] } },
  { code: 'A10',  name: 'Alim Cpa 1 x Setor 3 E 4',        type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 5.65,       INBOUND: 5.65       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 72  }] } },
  { code: 'A14',  name: 'Alim Cpa 3 x Dr Fabio',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 4.9,        INBOUND: 4.9        }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 60  }] } },
  { code: 'A15',  name: 'Alim Cpa 3 x A Da Serra',         type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 3.15,       INBOUND: 3.15       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 36  }] } },
  { code: 'A16',  name: 'Alim Cpa 3 x 1o De Marco',        type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 8.34,       INBOUND: 8.34       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 50  }] } },
  { code: 'A17',  name: 'Alim Cpa 3 x Planalto',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 3.06,       INBOUND: 3.06       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 38  }] } },
  { code: 'A20',  name: 'Alim Cpa 1 x Vila Da Serra',      type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 4.905,      INBOUND: 4.905      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 50  }] } },
  { code: 'A22',  name: 'Alim Ambev x Bandeira',           type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 11.7,       INBOUND: 11.7       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 60  }] } },
  { code: 'A22B', name: 'Sucuri x Vila Jardim',            type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 7.255,      INBOUND: 7.255      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 47  }] } },
  { code: 'A22C', name: 'Alim Ambev x Sucuri',             type: 'URBAN',        metrics: { extensionKm: { OUTBOUND: 5.54,       INBOUND: 5.54       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 38  }] } },
  { code: 'C01',  name: 'Universitaria',                   type: 'SPECIAL',      metrics: { extensionKm: { OUTBOUND: 12.4,       INBOUND: 12.4       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 99  }] } },
  { code: 'C02',  name: 'Circ Florais Italia x Av Trab',   type: 'SPECIAL',      metrics: { extensionKm: { OUTBOUND: 8.17,       INBOUND: 8.17       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 50  }] } },
  { code: 'R01',  name: 'Term Cpa 3 x Coxipo Do Ouro',     type: 'RURAL',        metrics: { extensionKm: { OUTBOUND: 20.15,      INBOUND: 20.15      }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 113 }] } },
  { code: 'R03',  name: 'Coxipo Acu x Est Alencastro',     type: 'RURAL',        metrics: { extensionKm: { OUTBOUND: 39.5,       INBOUND: 39.5       }, cycleWindows: [{ from: 0, to: 23, cycleMinutes: 170 }] } },
]

// ── routes ────────────────────────────────────────────────────────────────────

type RouteSeed = { lineCode: string; direction: string; name: string; originCode: string; destinationCode: string }
const ROUTES: RouteSeed[] = [
  { lineCode: '105',  direction: 'OUTBOUND', name: 'AMBEV - ALENC',   originCode: '1000', destinationCode: '1001' },
  { lineCode: '105',  direction: 'INBOUND',  name: 'ALENC - AMBEV',   originCode: '1001', destinationCode: '1000' },
  { lineCode: '107',  direction: 'INBOUND',  name: 'AMALIA - CPA 1',  originCode: '1002', destinationCode: '1003' },
  { lineCode: '107',  direction: 'OUTBOUND', name: 'CPA 1 - AMALIA',  originCode: '1003', destinationCode: '1002' },
  { lineCode: '203',  direction: 'OUTBOUND', name: 'MIKA - MATRIZ',   originCode: '1004', destinationCode: '1005' },
  { lineCode: '203',  direction: 'INBOUND',  name: 'MATRIZ - MIKA',   originCode: '1005', destinationCode: '1004' },
  { lineCode: '204',  direction: 'OUTBOUND', name: 'UBIRAJ - MATRIZ', originCode: '1006', destinationCode: '1005' },
  { lineCode: '204',  direction: 'INBOUND',  name: 'MATRIZ - UBIRAJ', originCode: '1005', destinationCode: '1006' },
  { lineCode: '205',  direction: 'OUTBOUND', name: 'DETRAN - MATRIZ', originCode: '1007', destinationCode: '1005' },
  { lineCode: '205',  direction: 'INBOUND',  name: 'MATRIZ - DETRAN', originCode: '1005', destinationCode: '1007' },
  { lineCode: '213',  direction: 'OUTBOUND', name: 'FLORIA - BISPO',  originCode: '1008', destinationCode: '1009' },
  { lineCode: '213',  direction: 'INBOUND',  name: 'BISPO - FLORIA',  originCode: '1009', destinationCode: '1008' },
  { lineCode: '225',  direction: 'OUTBOUND', name: 'ROD PQ - MATRIZ', originCode: '1010', destinationCode: '1005' },
  { lineCode: '225',  direction: 'INBOUND',  name: 'MATRIZ - ROD PQ', originCode: '1005', destinationCode: '1010' },
  { lineCode: '250',  direction: 'OUTBOUND', name: 'AMBEV - ALENC',   originCode: '1000', destinationCode: '1001' },
  { lineCode: '250',  direction: 'INBOUND',  name: 'ALENC - AMBEV',   originCode: '1001', destinationCode: '1000' },
  { lineCode: '251',  direction: 'OUTBOUND', name: 'HMC - ALENC',     originCode: '1011', destinationCode: '1001' },
  { lineCode: '251',  direction: 'INBOUND',  name: 'ALENC - HMC',     originCode: '1001', destinationCode: '1011' },
  { lineCode: '301',  direction: 'OUTBOUND', name: 'VITORI - IPIRAN', originCode: '1012', destinationCode: '1013' },
  { lineCode: '301',  direction: 'INBOUND',  name: 'IPIRAN - VITORI', originCode: '1013', destinationCode: '1012' },
  { lineCode: '302',  direction: 'OUTBOUND', name: 'V SERR - MATRIZ', originCode: '1014', destinationCode: '1005' },
  { lineCode: '302',  direction: 'INBOUND',  name: 'MATRIZ - V SERR', originCode: '1005', destinationCode: '1014' },
  { lineCode: '306',  direction: 'OUTBOUND', name: 'CPA 3 - GRD 3o',  originCode: '1015', destinationCode: '1016' },
  { lineCode: '306',  direction: 'INBOUND',  name: 'GRD 3o - CPA 3',  originCode: '1016', destinationCode: '1015' },
  { lineCode: '308',  direction: 'OUTBOUND', name: 'CPA 3 - AMBEV',   originCode: '1015', destinationCode: '1000' },
  { lineCode: '308',  direction: 'INBOUND',  name: 'AMBEV - CPA 3',   originCode: '1000', destinationCode: '1015' },
  { lineCode: '310',  direction: 'OUTBOUND', name: 'CPA 3 - BISPO',   originCode: '1015', destinationCode: '1009' },
  { lineCode: '310',  direction: 'INBOUND',  name: 'BISPO - CPA 3',   originCode: '1009', destinationCode: '1015' },
  { lineCode: '323',  direction: 'OUTBOUND', name: 'CPA 1 - CRD AQ',  originCode: '1003', destinationCode: '1017' },
  { lineCode: '323',  direction: 'INBOUND',  name: 'CRD AQ - CPA 1',  originCode: '1017', destinationCode: '1003' },
  { lineCode: '330',  direction: 'OUTBOUND', name: 'CPA 1 - UFMT',    originCode: '1003', destinationCode: '1018' },
  { lineCode: '330',  direction: 'INBOUND',  name: 'UFMT - CPA 1',    originCode: '1018', destinationCode: '1003' },
  { lineCode: '390',  direction: 'OUTBOUND', name: 'PICOLL - IPIRAN', originCode: '1019', destinationCode: '1013' },
  { lineCode: '390',  direction: 'INBOUND',  name: 'IPIRAN - PICOLL', originCode: '1013', destinationCode: '1019' },
  { lineCode: '409',  direction: 'OUTBOUND', name: 'PRAEIR - CORREI', originCode: '1020', destinationCode: '1021' },
  { lineCode: '409',  direction: 'INBOUND',  name: 'CORREI - PRAEIR', originCode: '1021', destinationCode: '1020' },
  { lineCode: '410',  direction: 'OUTBOUND', name: 'AMBEV - PRAEIR',  originCode: '1000', destinationCode: '1020' },
  { lineCode: '410',  direction: 'INBOUND',  name: 'PRAEIR - AMBEV',  originCode: '1020', destinationCode: '1000' },
  { lineCode: '800',  direction: 'OUTBOUND', name: 'GUIA - MATRIZ',   originCode: '1022', destinationCode: '1005' },
  { lineCode: '800',  direction: 'INBOUND',  name: 'MATRIZ - GUIA',   originCode: '1005', destinationCode: '1022' },
  { lineCode: '308B', direction: 'OUTBOUND', name: 'CPA 3 - ALENC',   originCode: '1015', destinationCode: '1001' },
  { lineCode: '308B', direction: 'INBOUND',  name: 'BISPO - CPA 3',   originCode: '1009', destinationCode: '1015' },
  { lineCode: 'A02',  direction: 'OUTBOUND', name: 'CPA 1 - PQ NAC',  originCode: '1003', destinationCode: '1023' },
  { lineCode: 'A02',  direction: 'INBOUND',  name: 'PQ NAC - CPA 1',  originCode: '1023', destinationCode: '1003' },
  { lineCode: 'A07',  direction: 'OUTBOUND', name: 'CPA 1 - S DOUR',  originCode: '1003', destinationCode: '1024' },
  { lineCode: 'A07',  direction: 'INBOUND',  name: 'S DOUR - CPA 1',  originCode: '1024', destinationCode: '1003' },
  { lineCode: 'A14',  direction: 'OUTBOUND', name: 'CPA 3 - DR FAB',  originCode: '1015', destinationCode: '1025' },
  { lineCode: 'A14',  direction: 'INBOUND',  name: 'DR FAB - CPA 3',  originCode: '1025', destinationCode: '1015' },
  { lineCode: 'A16',  direction: 'OUTBOUND', name: 'CPA 3 - I TERE',  originCode: '1015', destinationCode: '1026' },
  { lineCode: 'A16',  direction: 'INBOUND',  name: 'I TERE - CPA 3',  originCode: '1026', destinationCode: '1015' },
  { lineCode: 'A17',  direction: 'OUTBOUND', name: 'CPA 3 - PLANAL',  originCode: '1015', destinationCode: '1027' },
  { lineCode: 'A17',  direction: 'INBOUND',  name: 'PLANAL - CPA 3',  originCode: '1027', destinationCode: '1015' },
  { lineCode: 'A22',  direction: 'OUTBOUND', name: 'AMBEV - BANDEI',  originCode: '1000', destinationCode: '1028' },
  { lineCode: 'A22',  direction: 'INBOUND',  name: 'BANDEI - AMBEV',  originCode: '1028', destinationCode: '1000' },
  { lineCode: 'A22B', direction: 'OUTBOUND', name: 'SUCURI - V JARD', originCode: '1029', destinationCode: '1030' },
  { lineCode: 'A22B', direction: 'INBOUND',  name: 'V JARD - SUCURI', originCode: '1030', destinationCode: '1029' },
  { lineCode: 'A22C', direction: 'OUTBOUND', name: 'AMBEV - V JARD',  originCode: '1000', destinationCode: '1030' },
  { lineCode: 'A22C', direction: 'INBOUND',  name: 'V JARD - AMBEV',  originCode: '1030', destinationCode: '1000' },
  { lineCode: 'C01',  direction: 'OUTBOUND', name: 'UFMT - ALENC',    originCode: '1018', destinationCode: '1001' },
  { lineCode: 'C01',  direction: 'INBOUND',  name: 'ALENC - UFMT',    originCode: '1001', destinationCode: '1018' },
  { lineCode: 'C02',  direction: 'OUTBOUND', name: 'F ITAL - COMPER', originCode: '1031', destinationCode: '1032' },
  { lineCode: 'C02',  direction: 'INBOUND',  name: 'COMPER - F ITAL', originCode: '1032', destinationCode: '1031' },
  { lineCode: 'R01',  direction: 'OUTBOUND', name: 'CPA 3 - COXIPO',  originCode: '1015', destinationCode: '1033' },
  { lineCode: 'R01',  direction: 'INBOUND',  name: 'COXIPO - CPA 3',  originCode: '1033', destinationCode: '1015' },
  { lineCode: 'R03',  direction: 'OUTBOUND', name: 'AGUACU - MATRIZ', originCode: '1034', destinationCode: '1005' },
  { lineCode: 'R03',  direction: 'INBOUND',  name: 'MATRIZ - AGUACU', originCode: '1005', destinationCode: '1034' },
]

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding transit data…')

  // ── localities ──────────────────────────────────────────────────────────────

  for (const loc of LOCALITIES) {
    await prisma.transitLocality.upsert({
      where:  { code: loc.code },
      update: { name: loc.name, abbr: loc.abbr, lat: loc.lat, lng: loc.lng, isDepot: loc.isDepot ?? false },
      create: { code: loc.code, name: loc.name, abbr: loc.abbr, lat: loc.lat, lng: loc.lng, isDepot: loc.isDepot ?? false },
    })
  }
  console.log(`  ✓ localities (${LOCALITIES.length})`)

  // ── day types ───────────────────────────────────────────────────────────────

  const dayTypeMap = new Map<string, string>()
  for (const dt of DAY_TYPES) {
    const record = await prisma.dayType.upsert({
      where:  { code: dt.code },
      update: { name: dt.name, pattern: dt.pattern, priority: dt.priority, sortOrder: dt.sortOrder },
      create: { code: dt.code, name: dt.name, pattern: dt.pattern, priority: dt.priority, sortOrder: dt.sortOrder },
    })
    dayTypeMap.set(dt.code, record.id)
  }
  console.log(`  ✓ day types (${DAY_TYPES.length})`)

  // ── lines ───────────────────────────────────────────────────────────────────

  const lineMap = new Map<string, string>()
  for (const line of LINES) {
    const record = await prisma.transitLine.upsert({
      where:  { code: line.code },
      update: { name: line.name, type: line.type as any, metrics: line.metrics, isActive: true },
      create: { code: line.code, name: line.name, type: line.type as any, metrics: line.metrics, isActive: true },
    })
    lineMap.set(line.code, record.id)
  }
  console.log(`  ✓ lines (${LINES.length})`)

  // ── localities id map (needed for routes/travel-times) ──────────────────────

  const localityRecords = await prisma.transitLocality.findMany({ select: { id: true, code: true } })
  const localityMap = new Map(localityRecords.map(l => [l.code, l.id]))

  // ── routes ──────────────────────────────────────────────────────────────────

  const routeMap = new Map<string, string>() // key: `${lineCode}:${direction}`
  for (const r of ROUTES) {
    const lineId   = lineMap.get(r.lineCode)!
    const originId = localityMap.get(r.originCode)!
    const destId   = localityMap.get(r.destinationCode)!
    const existing = await prisma.transitRoute.findFirst({ where: { lineId, direction: r.direction as any } })
    const record   = existing ?? await prisma.transitRoute.create({
      data: { lineId, direction: r.direction as any, name: r.name, originLocalityId: originId, destinationLocalityId: destId, isActive: true },
    })
    routeMap.set(`${r.lineCode}:${r.direction}`, record.id)
  }
  console.log(`  ✓ routes (${ROUTES.length})`)

  console.log('Transit seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
