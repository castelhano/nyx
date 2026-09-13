import 'dotenv/config'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { json, urlencoded } from 'express'
import { AppModule } from './app.module'
import * as path from 'path'
import * as fs from 'fs'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.enableShutdownHooks()

  // Express/body-parser defaults to 100kb — too small for a full-line diff (many
  // pending trips) on the Gantt "Salvar" flow. Bumped, not removed.
  app.use(json({ limit: '10mb' }))
  app.use(urlencoded({ extended: true, limit: '10mb' }))

  const uploadsDir = path.join(process.cwd(), 'uploads')
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
  app.useStaticAssets(uploadsDir, { prefix: '/api/uploads' })

  app.enableCors()
  app.setGlobalPrefix('api')

  const port = process.env.PORT ?? 3001
  await app.listen(port)

  // http.Server#close() only stops accepting new connections — it waits forever for
  // existing keep-alive sockets to go idle, which they never do while the frontend
  // keeps polling. Force them shut so Ctrl+C/turbo's SIGINT actually exits promptly.
  const server = app.getHttpServer()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => server.closeAllConnections())
  }

  console.log(`API running on http://localhost:${port}/api`)
}

void bootstrap()
