import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

function toPosix(value) {
  return value.split(sep).join('/');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root) {
  if (!(await exists(root))) return [];
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await walk(root);
  return output;
}

export class RepositoryMediaStore {
  constructor({ rootDir = 'assets/media', publicBase = './assets/media' } = {}) {
    this.rootDir = resolve(process.cwd(), rootDir);
    this.publicBase = publicBase.replace(/\/$/, '');
    this.mode = 'repository';
  }

  pathFor(key) {
    const normalized = String(key).replace(/^\/+/, '');
    const path = resolve(this.rootDir, normalized);
    if (!path.startsWith(`${this.rootDir}${sep}`) && path !== this.rootDir) {
      throw new Error(`Media key fora do storage: ${key}`);
    }
    return path;
  }

  publicUrl(key) {
    return `${this.publicBase}/${String(key).replace(/^\/+/, '')}`;
  }

  async put(key, bytes) {
    const path = this.pathFor(key);
    if (!(await exists(path))) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      return { created: true, path, url: this.publicUrl(key), bytes: bytes.length };
    }
    const file = await stat(path);
    return { created: false, path, url: this.publicUrl(key), bytes: file.size };
  }

  async prune(referencedUrls = []) {
    const referenced = new Set(
      referencedUrls
        .filter(Boolean)
        .map((url) => String(url).replace(`${this.publicBase}/`, ''))
    );
    const files = await walkFiles(this.rootDir);
    let removed = 0;
    let removedBytes = 0;

    for (const path of files) {
      const key = toPosix(relative(this.rootDir, path));
      if (referenced.has(key)) continue;
      const file = await stat(path);
      await rm(path, { force: true });
      removed += 1;
      removedBytes += file.size;
    }

    return { removed, removedBytes };
  }
}
