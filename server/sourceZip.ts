import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Standard IEEE 802.3 CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

const ALLOWED_ROOT_FILES = [
  '.env.example',
  '.gitignore',
  'README.md',
  'bun.lock',
  'eslint.config.js',
  'favicon.ico',
  'firebase-applet-config.json',
  'firebase-blueprint.json',
  'firestore.rules',
  'firestore.rules.test.ts',
  'index.html',
  'metadata.json',
  'package.json',
  'security_spec.md',
  'server.ts',
  'storage.rules',
  'tsconfig.json',
  'vite.config.ts',
  'public/favicon.ico',
];

const ALLOWED_DIRS = ['src', 'server', 'public/assets', 'tests'];

const FORBIDDEN_PATTERNS = [
  /^\.env($|\.(?!example$))/i,
  /\.db($|-wal$|-shm$)/i,
  /\.zip$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /service[-_]?account.*\.json$/i,
  /\.DS_Store$/i,
];

function isSafeFilename(name: string): boolean {
  return !FORBIDDEN_PATTERNS.some((re) => re.test(name));
}

function collectAllowedFiles(rootDir: string): Array<{ relPath: string; absPath: string; mtime: Date }> {
  const resolvedRoot = path.resolve(rootDir);
  const rootPrefix = resolvedRoot + path.sep;
  const files: Array<{ relPath: string; absPath: string; mtime: Date }> = [];
  const seen = new Set<string>();

  const addFileIfSafe = (relPath: string) => {
    const normalizedRel = relPath.split(path.sep).join('/');
    if (seen.has(normalizedRel)) return;
    const baseName = path.basename(normalizedRel);
    if (!isSafeFilename(baseName)) return;

    const absPath = path.resolve(resolvedRoot, normalizedRel);
    if (!absPath.startsWith(rootPrefix)) return;
    if (!fs.existsSync(absPath)) return;

    const stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return;

    seen.add(normalizedRel);
    files.push({ relPath: normalizedRel, absPath, mtime: stat.mtime });
  };

  for (const rel of ALLOWED_ROOT_FILES) {
    addFileIfSafe(rel);
  }

  const walkDir = (dirRel: string) => {
    const absDir = path.resolve(resolvedRoot, dirRel);
    if (!absDir.startsWith(rootPrefix) || !fs.existsSync(absDir)) return;
    const dirStat = fs.lstatSync(absDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return;

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'data') {
        continue;
      }
      const childRel = path.posix.join(dirRel.split(path.sep).join('/'), entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walkDir(childRel);
      } else if (entry.isFile()) {
        addFileIfSafe(childRel);
      }
    }
  };

  for (const dir of ALLOWED_DIRS) {
    walkDir(dir);
  }

  return files;
}

export function buildCleanSourceZip(rootDir: string = process.cwd()): {
  buffer: Buffer;
  fileCount: number;
  filename: string;
} {
  const files = collectAllowedFiles(rootDir);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file.absPath);
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(raw);
    const { dosTime, dosDate } = toDosTimeDate(file.mtime);
    const nameBuf = Buffer.from(`sgn-committee-hisaab/${file.relPath}`, 'utf8');

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4); // Version needed (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // General purpose flag (UTF-8)
    localHeader.writeUInt16LE(method, 8); // Compression method
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra length

    localParts.push(localHeader, nameBuf, payload);

    // Central Directory File Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number
    centralHeader.writeUInt16LE(0, 36); // Internal attrs
    centralHeader.writeUInt32LE(0, 38); // External attrs
    centralHeader.writeUInt32LE(offset, 42); // Local header offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk with central dir
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // Comment length

  return {
    buffer: Buffer.concat([...localParts, centralDirBuffer, eocd]),
    fileCount: files.length,
    filename: 'SGN-Committee-Hisaab-Source.zip',
  };
}
