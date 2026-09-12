/**
 * 媒体索引读写与路径护栏（mod-002 §3.1、§4.1、§5.2；详设 §4.4 文件路径）。
 *
 * - 媒体 / 产物引用只存应用数据目录内的**相对路径**（不接受绝对路径）；
 * - 任何解析后的路径必须落在应用数据目录内（防路径穿越）；
 * - `_media_index` 记录「相对路径 → 归属引用」，删除时按索引清理文件（§5.3 提交后清理）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, normalize, resolve, sep } from 'node:path'

import type Database from 'better-sqlite3'

import { classifyStorageFailure, invalidInput, mediaNotFound } from '../errors'

/** 索引归属：记录实体类型 + 记录身份。 */
export interface MediaOwner {
  entityType: string
  entityId: string
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
}

/** 媒体引用读取结果。 */
export interface MediaPayload {
  bytes: Uint8Array
  mime: string
}

/**
 * 解析媒体 / 产物引用为应用数据目录内的绝对路径（路径护栏）。
 *
 * 拒绝：绝对路径、空引用、含 `..` 跳出数据目录、含 NUL。
 */
export function resolveWithinDataDir(dataDir: string, ref: string): string {
  if (typeof ref !== 'string' || ref === '') {
    throw invalidInput('媒体引用非法：应为非空相对路径', { ref: String(ref) })
  }
  if (ref.includes('\u0000')) {
    throw invalidInput('媒体引用非法：含非法字符', { ref })
  }
  if (isAbsolute(ref)) {
    throw invalidInput('媒体引用非法：不接受绝对路径（§5.2 只存相对路径）', { ref })
  }
  const root = resolve(dataDir)
  const target = resolve(root, normalize(ref))
  if (target !== root && !target.startsWith(root + sep)) {
    throw invalidInput('媒体引用非法：解析后落在应用数据目录之外', { ref })
  }
  return target
}

/** 按扩展名推断 MIME（未知类型退化为二进制流）。 */
export function mimeForRef(ref: string): string {
  return MIME_BY_EXTENSION[extname(ref).toLowerCase()] ?? 'application/octet-stream'
}

/** 读取媒体 / 产物字节（路径护栏 + 文件存在性）。 */
export function readMediaFile(dataDir: string, ref: string): MediaPayload {
  const target = resolveWithinDataDir(dataDir, ref)
  let bytes: Buffer
  try {
    bytes = readFileSync(target)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ENOENT' || code === 'EISDIR') {
      throw mediaNotFound(ref)
    }
    throw classifyStorageFailure(error, 'store:media')
  }
  return { bytes, mime: mimeForRef(ref) }
}

/** 写入媒体 / 产物字节（仅接受数据目录内的相对路径；父目录自动创建）。 */
export function writeMediaFile(dataDir: string, ref: string, bytes: Uint8Array): void {
  const target = resolveWithinDataDir(dataDir, ref)
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  } catch (error) {
    throw classifyStorageFailure(error, 'store:media')
  }
}

/** 登记归属记录的媒体 / 产物引用（替换该归属的既有索引行）。 */
export function replaceMediaIndex(
  db: Database.Database,
  owner: MediaOwner,
  entries: ReadonlyArray<{ ref: string; kind: 'media' | 'artifact' }>,
): void {
  db.prepare('DELETE FROM _media_index WHERE entity_type = ? AND entity_id = ?').run(
    owner.entityType,
    owner.entityId,
  )
  const insert = db.prepare(
    'INSERT INTO _media_index (path, kind, entity_type, entity_id) VALUES (?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET kind = excluded.kind, entity_type = excluded.entity_type, entity_id = excluded.entity_id',
  )
  for (const entry of entries) {
    // 引用不做解析、只登记原样相对路径；解析与护栏在读取 / 清理时执行。
    insert.run(entry.ref, entry.kind, owner.entityType, owner.entityId)
  }
}

/** 登记单条媒体 / 产物引用（不清除该归属的其他索引行）。 */
export function registerMediaRef(
  db: Database.Database,
  owner: MediaOwner,
  ref: string,
  kind: 'media' | 'artifact',
): void {
  db.prepare(
    'INSERT INTO _media_index (path, kind, entity_type, entity_id) VALUES (?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET kind = excluded.kind, entity_type = excluded.entity_type, entity_id = excluded.entity_id',
  ).run(ref, kind, owner.entityType, owner.entityId)
}

/** 读取某归属记录的媒体 / 产物引用（删除清理用）。 */
export function mediaRefsOfOwner(db: Database.Database, owner: MediaOwner): string[] {
  const rows = db
    .prepare('SELECT path FROM _media_index WHERE entity_type = ? AND entity_id = ? ORDER BY path')
    .all(owner.entityType, owner.entityId) as Array<{ path: string }>
  return rows.map((row) => row.path)
}
