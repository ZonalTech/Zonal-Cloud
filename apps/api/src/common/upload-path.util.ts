import * as path from 'path';

// Root directory where uploaded app source trees are stored, one subdir per
// app id. Configurable via UPLOAD_ROOT; defaults to a stable local path.
export function uploadRoot(): string {
  return process.env.UPLOAD_ROOT ?? '/tmp/zonal-uploads';
}

// The directory holding a single app's most recently uploaded source files.
export function appUploadDir(appId: string): string {
  return path.join(uploadRoot(), appId);
}
