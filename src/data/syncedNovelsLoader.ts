import { Novel, Chapter } from '../types';
import syncedCatalogJson from '../../data/synced-novels.json';

interface SyncedCatalogFile {
  updatedAt?: string;
  totalNovels?: number;
  novels?: Novel[];
}

interface NovelMetaFile {
  id: string;
  title: string;
  author: string;
  genre: string;
  status?: 'Đang ra' | 'Hoàn thành';
  synopsis: string;
  coverStyle?: Novel['coverStyle'];
  coverImageUrl?: string;
  views?: number;
  rating?: number;
  updatedAt?: string;
  sourceUrl?: string;
  autoFetchEnabled?: boolean;
  lastSyncedAt?: string;
  pendingChapterLinks?: { title: string; url: string }[];
  chapters?: Chapter[];
}

const SAMPLE_NOVEL_IDS_SET = new Set([
  'kiem-lai-thien-ha',
  'thanh-van-kiem-tich',
  'van-co-kiem-ton',
  'co-anh-thanh-tich-luoc',
  'da-anh-truong-an',
  'phong-nguyet-kinh-hua',
  'tram-nam-tinh-ha',
  'bien-nien-su-sao-bang',
  'hai-dang-luong-tu',
  'van-co-thu-vien',
  'son-hai-di-van-luc',
  'cuu-chau-muc-linh-do'
]);

let globCatalogModules: Record<string, unknown> = {};
let globNovelMetaModules: Record<string, unknown> = {};
let globChapterModules: Record<string, unknown> = {};

try {
  globCatalogModules = import.meta.glob('../../data/*.json', {
    eager: true
  });

  globNovelMetaModules = import.meta.glob('../../novels/*/novel.json', {
    eager: true
  });

  globChapterModules = import.meta.glob('../../novels/*/chapters/*.json', {
    eager: true
  });
} catch {
  // Fallback when imported inside Node.js runtime (server.ts) where import.meta.glob is unavailable
}

function unwrapModule<T>(mod: unknown): T | null {
  if (!mod || typeof mod !== 'object') return null;
  if ('default' in (mod as Record<string, unknown>) && (mod as Record<string, unknown>).default) {
    return (mod as { default: T }).default;
  }
  return mod as T;
}

function mergeChapterLists(listA: Chapter[] = [], listB: Chapter[] = []): Chapter[] {
  const byNumber = new Map<number, Chapter>();
  for (const rawCh of [...listA, ...listB]) {
    if (!rawCh || typeof rawCh !== 'object') continue;
    const num = Number(rawCh.number) || byNumber.size + 1;
    const content = Array.isArray(rawCh.content) ? rawCh.content : [];
    const existing = byNumber.get(num);
    if (!existing || content.length >= (existing.content?.length || 0)) {
      byNumber.set(num, {
        ...existing,
        ...rawCh,
        number: num,
        content
      });
    }
  }
  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
}

export function isPriorityFeaturedNovel(novel: Novel): boolean {
  const idLower = (novel.id || '').toLowerCase();
  const titleLower = (novel.title || '').toLowerCase();
  return (
    idLower.includes('nguoi-tren-van-nguoi') ||
    titleLower.includes('người trên vạn người') ||
    titleLower.includes('nguoi tren van nguoi')
  );
}

export function loadSyncedNovelsFromRepo(): Novel[] {
  const byId = new Map<string, Novel>();

  const ingestCatalogObject = (catalog: SyncedCatalogFile | null) => {
    if (!catalog || !Array.isArray(catalog.novels)) return;
    for (const item of catalog.novels) {
      if (!item || !item.id || !item.title || SAMPLE_NOVEL_IDS_SET.has(item.id)) continue;
      const existing = byId.get(item.id);
      const mergedChapters = mergeChapterLists(existing?.chapters || [], item.chapters || []);
      byId.set(item.id, {
        ...existing,
        ...item,
        status: item.status === 'Hoàn thành' ? 'Hoàn thành' : 'Đang ra',
        coverStyle: item.coverStyle || existing?.coverStyle || 'star-nebula',
        views: Number(item.views) || existing?.views || 1,
        rating: Number(item.rating) || existing?.rating || 5.0,
        updatedAt: item.updatedAt || existing?.updatedAt || new Date().toISOString(),
        chapters: mergedChapters
      });
    }
  };

  // 1. Always load directly imported data/synced-novels.json (works in both Vite bundle & Node tsx)
  ingestCatalogObject(unwrapModule<SyncedCatalogFile>(syncedCatalogJson));

  // 2. Also ingest any additional JSON files matched in data/*.json via Vite glob
  for (const rawMod of Object.values(globCatalogModules)) {
    ingestCatalogObject(unwrapModule<SyncedCatalogFile>(rawMod));
  }

  // 3. Collect all chapter files from novels/<slug>/chapters/*.json
  const chaptersBySlug = new Map<string, Chapter[]>();
  const chaptersByNovelId = new Map<string, Chapter[]>();

  for (const [filePath, rawMod] of Object.entries(globChapterModules)) {
    const chap = unwrapModule<Chapter>(rawMod);
    if (!chap || typeof chap !== 'object') continue;

    const match = filePath.match(/novels\/([^/]+)\/chapters\//);
    const normalizedChap: Chapter = {
      ...chap,
      number: Number(chap.number) || 1,
      content: Array.isArray(chap.content) ? chap.content : []
    };

    if (match) {
      const slug = match[1];
      const list = chaptersBySlug.get(slug) || [];
      list.push(normalizedChap);
      chaptersBySlug.set(slug, list);
    }

    if (chap.novelId) {
      const byNovelList = chaptersByNovelId.get(chap.novelId) || [];
      byNovelList.push(normalizedChap);
      chaptersByNovelId.set(chap.novelId, byNovelList);
    }
  }

  // 4. Merge novels/<slug>/novel.json metadata + chapters
  for (const [filePath, rawMod] of Object.entries(globNovelMetaModules)) {
    const meta = unwrapModule<NovelMetaFile>(rawMod);
    if (!meta || !meta.id || !meta.title || SAMPLE_NOVEL_IDS_SET.has(meta.id)) continue;

    const match = filePath.match(/novels\/([^/]+)\/novel\.json$/);
    const slug = match ? match[1] : meta.id;

    const slugChapters = chaptersBySlug.get(slug) || [];
    const idChapters = chaptersByNovelId.get(meta.id) || [];
    const folderChapters = mergeChapterLists(slugChapters, idChapters);

    const existing = byId.get(meta.id);
    const mergedChapters = mergeChapterLists(
      mergeChapterLists(existing?.chapters || [], meta.chapters || []),
      folderChapters
    );

    byId.set(meta.id, {
      id: meta.id,
      title: meta.title,
      author: meta.author || existing?.author || 'Ẩn Danh',
      genre: meta.genre || existing?.genre || 'Huyền Huyễn',
      status: meta.status === 'Hoàn thành' ? 'Hoàn thành' : 'Đang ra',
      synopsis: meta.synopsis || existing?.synopsis || '',
      coverStyle: meta.coverStyle || existing?.coverStyle || 'star-nebula',
      ...(meta.coverImageUrl || existing?.coverImageUrl
        ? { coverImageUrl: meta.coverImageUrl || existing?.coverImageUrl }
        : {}),
      views: Math.max(Number(meta.views) || 0, Number(existing?.views) || 0, 1),
      rating: Number(meta.rating) || existing?.rating || 5.0,
      updatedAt: meta.updatedAt || existing?.updatedAt || new Date().toISOString(),
      ...(meta.sourceUrl || existing?.sourceUrl
        ? { sourceUrl: meta.sourceUrl || existing?.sourceUrl }
        : {}),
      ...(meta.autoFetchEnabled !== undefined
        ? { autoFetchEnabled: meta.autoFetchEnabled }
        : existing?.autoFetchEnabled !== undefined
        ? { autoFetchEnabled: existing.autoFetchEnabled }
        : {}),
      ...(meta.lastSyncedAt || existing?.lastSyncedAt
        ? { lastSyncedAt: meta.lastSyncedAt || existing?.lastSyncedAt }
        : {}),
      ...(meta.pendingChapterLinks || existing?.pendingChapterLinks
        ? {
            pendingChapterLinks:
              (meta.pendingChapterLinks?.length || 0) >= (existing?.pendingChapterLinks?.length || 0)
                ? meta.pendingChapterLinks
                : existing?.pendingChapterLinks
          }
        : {}),
      chapters: mergedChapters
    });
  }

  // 5. Also attach any chapters from chaptersByNovelId even if novel.json was only in synced-novels.json
  for (const [novelId, chaps] of chaptersByNovelId.entries()) {
    const existing = byId.get(novelId);
    if (existing) {
      existing.chapters = mergeChapterLists(existing.chapters || [], chaps);
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const aPriority = isPriorityFeaturedNovel(a) ? 1 : 0;
    const bPriority = isPriorityFeaturedNovel(b) ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
