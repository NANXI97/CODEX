import {imageSize} from 'image-size';
import {z} from 'zod';
import type {DocumentFormat, DocumentInput} from './types';
import {ProviderError} from './provider';

export const recognitionSchema = z.object({
 text: z.string().max(12000),
 coverage: z.enum(['complete', 'partial', 'unreadable']),
 uncertain: z.array(z.string().max(400)).max(20),
 notes: z.string().max(1000),
}).strict();

const mimeTypes: Record<DocumentFormat, DocumentInput['mimeType']> = {
 pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};
export function documentInput(name: string, format: DocumentFormat, bytes: Buffer): DocumentInput {
 const invalid = (message: string): never => {throw new ProviderError('INVALID_FILE', message);};
 if (format === 'pdf') {
  // Only inspect the container; OpenAI validates/reads the actual PDF. Never execute its contents.
  if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(bytes.subarray(0, 8).toString('ascii')) || !bytes.subarray(-4096).includes(Buffer.from('%%EOF'))) invalid('PDF 文件头或结尾无效。');
  if (bytes.includes(Buffer.from('/Encrypt'))) invalid('暂不支持加密 PDF，请上传未加密的政策资料。');
 } else {
  try {
   const size = imageSize(bytes), expected = format === 'jpg' || format === 'jpeg' ? 'jpg' : format;
   if (size.type !== expected || !size.width || !size.height || size.width > 8192 || size.height > 8192 || size.width * size.height > 16000000) invalid('图片格式与扩展名不符，或尺寸超过 8192 像素／1600 万像素。');
   if (format === 'png' && bytes.includes(Buffer.from('acTL'))) invalid('暂不支持动态图片，请上传静态政策截图。');
   if (format === 'webp' && bytes.includes(Buffer.from('ANIM'))) invalid('暂不支持动态图片，请上传静态政策截图。');
  } catch (error) {if (error instanceof ProviderError) throw error; invalid('图片格式无效，请上传 PNG、JPEG 或静态 WEBP。');}
 }
 return {name, mimeType: mimeTypes[format], bytes};
}
