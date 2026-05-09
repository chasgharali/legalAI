import path from 'path';
import fs from 'fs/promises';

function hasRealS3Credentials(): boolean {
  const id = process.env.AWS_ACCESS_KEY_ID ?? '';
  const secret = process.env.AWS_SECRET_ACCESS_KEY ?? '';
  return id.length > 10 && id !== '...' && secret.length > 10 && secret !== '...';
}

async function uploadLocal(key: string, body: Buffer): Promise<string> {
  const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');
  const dest = path.join(uploadsRoot, key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body);
  return `/uploads/${key}`;
}

async function uploadS3(key: string, body: Buffer, contentType: string): Promise<string> {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? 'eu-west-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const BUCKET = process.env.AWS_S3_BUCKET ?? 'medchron-documents';
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    })
  );
  return `s3://${BUCKET}/${key}`;
}

export async function uploadFile(
  key: string,
  body: Buffer,
  contentType = 'application/pdf'
): Promise<string> {
  if (hasRealS3Credentials()) {
    return uploadS3(key, body, contentType);
  }
  return uploadLocal(key, body);
}

export async function getFileUrl(storedUrl: string): Promise<string> {
  if (storedUrl.startsWith('/uploads/')) return storedUrl;

  if (storedUrl.startsWith('s3://') && hasRealS3Credentials()) {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const BUCKET = process.env.AWS_S3_BUCKET ?? 'medchron-documents';
    const key = storedUrl.replace(`s3://${BUCKET}/`, '');
    const s3 = new S3Client({
      region: process.env.AWS_REGION ?? 'eu-west-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
  }

  return storedUrl;
}
