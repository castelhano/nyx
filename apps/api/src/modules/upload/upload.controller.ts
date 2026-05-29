import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, BadRequestException, Query } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { JwtAuthGuard } from '../../auth/policies.guard'
import * as path from 'path'
import * as crypto from 'crypto'
import * as fs from 'fs'

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  @Post('image')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      // folder = '<domain>/<resource>' — e.g. 'hr/employees'; falls back to root uploads/
      destination: (req, _file, cb) => {
        const folder = (req.query as Record<string, string>).folder ?? ''
        const dest = path.join(process.cwd(), 'uploads', folder)
        fs.mkdirSync(dest, { recursive: true })
        cb(null, dest)
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        cb(null, `${crypto.randomUUID()}${ext}`)
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new BadRequestException('Apenas imagens são permitidas'), false)
      }
      cb(null, true)
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  uploadImage(@UploadedFile() file: Express.Multer.File, @Query('folder') folder = '') {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado')
    const subpath = folder ? `${folder}/` : ''
    return { url: `/api/uploads/${subpath}${file.filename}` }
  }
}
