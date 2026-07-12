import { v2 as cloudinary } from 'cloudinary';
import { env } from './business.env';

cloudinary.config({
  cloud_name: env.CLOUDINARY_URL.split('@')[1],
  api_key: env.API_KEY_CLOUDINARY,
  api_secret: env.API_SECRET_CLOUDINARY,
});

export function uploadImageBuffer(buffer: Buffer, folder: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error || new Error('Cloudinary upload failed'));
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

export default cloudinary;
