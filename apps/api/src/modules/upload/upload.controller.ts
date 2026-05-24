import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, BadRequestException } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { JwtAuthGuard } from '../../auth/policies.guard'
import * as path from 'path'
import * as crypto from 'crypto'

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  @Post('image')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: path.join(process.cwd(), 'uploads'),
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
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado')
    return { url: `/api/uploads/${file.filename}` }
  }
}
