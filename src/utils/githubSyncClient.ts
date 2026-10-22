import { Novel, Chapter } from '../types';
import { SAMPLE_NOVEL_IDS, isPriorityFeaturedNovel } from '../data/seedNovels';

export const GITHUB_CONFIG_STORAGE_KEY = 'mac_thu_cac_github_sync_config_v1';
export const NOVELS_LOCAL_CACHE_KEY = 'mac_thu_cac_synced_novels_cache_v2';
const LEGACY_NOVELS_CACHE_KEYS = [
  'mac_thu_cac_synced_novels_cache_v1',
  'mac_thu_cac_novels_v1',
  'mac_thu_cac_novels_cache'
];

export interface GitHubSyncConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  autoPush: boolean;
  lastPushAt?: string;
  lastCommitSha?: string;
  lastCommitUrl?: string;
  lastError?: string;
}

export interface GitHubPushResult {
  success: boolean;
  commitSha?: string;
  commitUrl?: string;
  pushedAt?: string;
  filesCount?: number;
  error?: string;
}

export function parseGitHubOwnerAndRepo(rawOwner: string, rawRepo: string): { owner: string; repo: string } {
  const combined = `${rawOwner.trim()}/${rawRepo.trim()}`
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  if (rawRepo.includes('github.com') || rawRepo.includes('/')) {
    const cleanedRepoInput = rawRepo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleanedRepoInput.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  }

  const parts = combined.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] };
  }

  return {
    owner: rawOwner.trim(),
    repo: rawRepo.trim().replace(/\.git$/i, '')
  };
}

export function loadLocalGitHubConfig(): GitHubSyncConfig {
  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        token: parsed.token || '',
        owner: parsed.owner || '',
        repo: parsed.repo || '',
        branch: parsed.branch || 'main',
        autoPush: parsed.autoPush !== undefined ? Boolean(parsed.autoPush) : true,
        lastPushAt: parsed.lastPushAt,
        lastCommitSha: parsed.lastCommitSha,
        lastCommitUrl: parsed.lastCommitUrl,
        lastError: parsed.lastError
      };
    }
  } catch {
    // ignore
  }
  return {
    token: '',
    owner: '',
    repo: '',
    branch: 'main',
    autoPush: true
  };
}

export function saveLocalGitHubConfig(partial: Partial<GitHubSyncConfig>): GitHubSyncConfig {
  const current = loadLocalGitHubConfig();
  const next: GitHubSyncConfig = {
    ...current,
    ...partial
  };
  try {
    localStorage.setItem(GITHUB_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function buildGitHubSyncFiles(novels: Novel[]): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const nowIso = new Date().toISOString();

  files.push({
    path: 'data/synced-novels.json',
    content: JSON.stringify(
      {
        updatedAt: nowIso,
        totalNovels: novels.length,
        novels
      },
      null,
      2
    )
  });

  for (const novel of novels) {
    const safeSlug =
      novel.id
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'novel';

    const { chapters, ...novelMeta } = novel;
    files.push({
      path: `novels/${safeSlug}/novel.json`,
      content: JSON.stringify(
        {
          ...novelMeta,
          chapterCount: chapters.length,
          chaptersIndex: chapters.map((c) => ({
            id: c.id,
            number: c.number,
            title: c.title,
            wordCount: c.wordCount,
            publishedAt: c.publishedAt,
            ...(c.sourceChapterUrl ? { sourceChapterUrl: c.sourceChapterUrl } : {})
          }))
        },
        null,
        2
      )
    });

    for (const ch of chapters) {
      files.push({
        path: `novels/${safeSlug}/chapters/chapter-${ch.number}.json`,
        content: JSON.stringify(ch, null, 2)
      });
    }
  }

  return files;
}

export async function pushNovelsToGitHubDirect(
  novels: Novel[],
  config: GitHubSyncConfig,
  commitMessage?: string
): Promise<GitHubPushResult> {
  const { owner, repo } = parseGitHubOwnerAndRepo(config.owner, config.repo);
  const branch = (config.branch || 'main').trim() || 'main';
  const token = config.token.trim();

  if (!token || !owner || !repo) {
    return {
      success: false,
      error: 'Thiếu GitHub Token, Owner hoặc tên Repository.'
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    // 1. Get latest commit on target branch
    const refRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      { headers }
    );
    if (!refRes.ok) {
      const errBody = await refRes.json().catch(() => ({}));
      throw new Error(
        errBody.message ||
          `Không tìm thấy nhánh "${branch}" trên repo ${owner}/${repo} (HTTP ${refRes.status}).`
      );
    }
    const refData = await refRes.json();
    const latestCommitSha: string = refData.object.sha;

    // 2. Get base tree SHA of that commit
    const commitRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${latestCommitSha}`,
      { headers }
    );
    if (!commitRes.ok) {
      throw new Error(`Không thể đọc commit gốc trên GitHub (HTTP ${commitRes.status}).`);
    }
    const commitData = await commitRes.json();
    const baseTreeSha: string = commitData.tree.sha;

    // 3. Build tree items
    const files = buildGitHubSyncFiles(novels);
    const treeItems = files.map((file) => ({
      path: file.path,
      mode: '100644',
      type: 'blob',
      content: file.content
    }));

    const treeRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems
        })
      }
    );
    if (!treeRes.ok) {
      const errBody = await treeRes.json().catch(() => ({}));
      throw new Error(errBody.message || `Không thể tạo Git Tree (HTTP ${treeRes.status}).`);
    }
    const treeData = await treeRes.json();

    // 4. Create new commit
    const totalChapters = novels.reduce((sum, n) => sum + (n.chapters?.length || 0), 0);
    const finalMessage =
      commitMessage ||
      `chore(sync): đồng bộ ${novels.length} truyện (${totalChapters} chương) lên Mạc Thư Các`;

    const newCommitRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: finalMessage,
          tree: treeData.sha,
          parents: [latestCommitSha]
        })
      }
    );
    if (!newCommitRes.ok) {
      const errBody = await newCommitRes.json().catch(() => ({}));
      throw new Error(errBody.message || `Không thể tạo Commit mới (HTTP ${newCommitRes.status}).`);
    }
    const newCommitData = await newCommitRes.json();

    // 5. Update branch reference
    const updateRefRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: false
        })
      }
    );
    if (!updateRefRes.ok) {
      const errBody = await updateRefRes.json().catch(() => ({}));
      throw new Error(errBody.message || `Không thể cập nhật nhánh ${branch} (HTTP ${updateRefRes.status}).`);
    }

    const pushedAt = new Date().toISOString();
    const commitUrl = `https://github.com/${owner}/${repo}/commit/${newCommitData.sha}`;

    saveLocalGitHubConfig({
      owner,
      repo,
      branch,
      lastPushAt: pushedAt,
      lastCommitSha: newCommitData.sha,
      lastCommitUrl: commitUrl,
      lastError: undefined
    });

    return {
      success: true,
      commitSha: newCommitData.sha,
      commitUrl,
      pushedAt,
      filesCount: files.length
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định khi đẩy lên GitHub.';
    saveLocalGitHubConfig({ lastError: errorMsg });
    return {
      success: false,
      error: errorMsg
    };
  }
}

export async function syncNovelsToGitHub(
  novels: Novel[],
  commitMessage?: string,
  overrideConfig?: Partial<GitHubSyncConfig>
): Promise<GitHubPushResult> {
  const localCfg = loadLocalGitHubConfig();
  const mergedCfg: GitHubSyncConfig = {
    ...localCfg,
    ...overrideConfig
  };
  const { owner, repo } = parseGitHubOwnerAndRepo(mergedCfg.owner, mergedCfg.repo);
  mergedCfg.owner = owner;
  mergedCfg.repo = repo;

  // 1. Try server endpoint first so local disk (/data/synced-novels.json & /novels/) is also updated
  try {
    const res = await fetch('/api/github/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novels,
        commitMessage,
        token: mergedCfg.token || undefined,
        owner: mergedCfg.owner || undefined,
        repo: mergedCfg.repo || undefined,
        branch: mergedCfg.branch || 'main',
        autoPush: mergedCfg.autoPush
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        saveLocalGitHubConfig({
          lastPushAt: data.pushedAt,
          lastCommitSha: data.commitSha,
          lastCommitUrl: data.commitUrl,
          lastError: undefined
        });
        return {
          success: true,
          commitSha: data.commitSha,
          commitUrl: data.commitUrl,
          pushedAt: data.pushedAt,
          filesCount: data.filesCount
        };
      }
    }
  } catch {
    // Server route unreachable (e.g., running as static build on Vercel) -> fallback to direct browser GitHub API
  }

  // 2. Fallback to direct browser-to-GitHub REST API call (works on Vercel static deployment)
  return pushNovelsToGitHubDirect(novels, mergedCfg, commitMessage);
}

export async function fetchLatestSyncedNovelsFromGitHub(config?: GitHubSyncConfig): Promise<Novel[] | null> {
  const cfg = config || loadLocalGitHubConfig();
  const { owner, repo } = parseGitHubOwnerAndRepo(cfg.owner, cfg.repo);
  const branch = (cfg.branch || 'main').trim() || 'main';
  if (!owner || !repo) return null;

  try {
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/data/synced-novels.json?t=${Date.now()}`;
    const res = await fetch(rawUrl, {
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : undefined
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && Array.isArray(data.novels)) {
      return data.novels;
    }
  } catch {
    // ignore
  }
  return null;
}

export function loadCachedNovelsFromStorage(): Novel[] {
  try {
    for (const oldKey of LEGACY_NOVELS_CACHE_KEYS) {
      localStorage.removeItem(oldKey);
    }
    const raw = localStorage.getItem(NOVELS_LOCAL_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (n) => n && n.id && n.title && !SAMPLE_NOVEL_IDS.includes(n.id)
        );
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveCachedNovelsToStorage(novels: Novel[]): void {
  try {
    const clean = novels.filter(
      (n) => n && n.id && n.title && !SAMPLE_NOVEL_IDS.includes(n.id)
    );
    localStorage.setItem(NOVELS_LOCAL_CACHE_KEY, JSON.stringify(clean));
  } catch {
    // ignore quota errors
  }
}

export function mergeNovelsLists(primary: Novel[], secondary: Novel[]): Novel[] {
  const byId = new Map<string, Novel>();

  // 1. Insert primary (repo / server authoritative novels) FIRST so their order & metadata take precedence
  for (const n of primary) {
    if (!n || !n.id || !n.title || SAMPLE_NOVEL_IDS.includes(n.id)) continue;
    byId.set(n.id, n);
  }

  // 2. Merge secondary (e.g., local cache) without letting stale cache overwrite primary metadata
  for (const n of secondary) {
    if (!n || !n.id || !n.title || SAMPLE_NOVEL_IDS.includes(n.id)) continue;
    const existing = byId.get(n.id);
    if (!existing) {
      byId.set(n.id, n);
    } else {
      const chapMap = new Map<number, Chapter>();
      for (const ch of [...(n.chapters || []), ...(existing.chapters || [])]) {
        if (!ch || typeof ch !== 'object') continue;
        const num = Number(ch.number) || 1;
        const prev = chapMap.get(num);
        if (!prev || (ch.content?.length || 0) >= (prev.content?.length || 0)) {
          chapMap.set(num, { ...ch, number: num });
        }
      }
      const mergedChapters = Array.from(chapMap.values()).sort((a, b) => a.number - b.number);
      const isExistingNewer =
        new Date(existing.updatedAt || 0).getTime() >= new Date(n.updatedAt || 0).getTime();

      byId.set(n.id, {
        ...(isExistingNewer ? { ...n, ...existing } : { ...existing, ...n }),
        title: existing.title || n.title,
        author: existing.author || n.author,
        genre: existing.genre || n.genre,
        synopsis: existing.synopsis || n.synopsis,
        coverImageUrl: existing.coverImageUrl || n.coverImageUrl,
        views: Math.max(Number(existing.views) || 0, Number(n.views) || 0, 1),
        chapters: mergedChapters,
        pendingChapterLinks:
          (existing.pendingChapterLinks?.length || 0) >= (n.pendingChapterLinks?.length || 0)
            ? existing.pendingChapterLinks
            : n.pendingChapterLinks
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const aPriority = isPriorityFeaturedNovel(a) ? 1 : 0;
    const bPriority = isPriorityFeaturedNovel(b) ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

function countWordsClient(paragraphs: string[]): number {
  return paragraphs.reduce((acc, p) => acc + p.trim().split(/\s+/).length, 0);
}

export interface ClientExtractedUrlData {
  url: string;
  title: string;
  chapterTitle?: string;
  author: string;
  genre: string;
  synopsis: string;
  coverImageUrl?: string;
  parentBookUrl?: string;
  firstChapterUrl?: string;
  paragraphs: string[];
  chapterLinks: { title: string; url: string; number?: number }[];
  nextChapterUrl?: string;
  nextChapterTitle?: string;
}

export async function extractUrlClientSide(rawUrl: string): Promise<ClientExtractedUrlData> {
  const normalizedUrl = rawUrl.trim().startsWith('http') ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const parsedUrl = new URL(normalizedUrl);

  const proxyCandidates = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(normalizedUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(normalizedUrl)}`
  ];

  let html = '';
  for (const proxyUrl of proxyCandidates) {
    try {
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 200) {
          html = text;
          break;
        }
      }
    } catch {
      // try next proxy
    }
  }

  if (!html) {
    throw new Error('Không thể tải trang nguồn từ trình duyệt. Hãy kiểm tra lại đường dẫn URL.');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const rawPageTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    doc.querySelector('title')?.textContent ||
    parsedUrl.hostname;

  const cleanPageTitle = rawPageTitle
    .replace(/\s*[-|_–—]\s*(Storya|TruyenFull|Metruyenchu|Tangthuvien|Wattpad|Wikidich|Sangtacviet|DocTruyen|TruyenYY|TruyenQQ).*$/i, '')
    .trim();

  let novelTitle = cleanPageTitle.replace(/\s+(?:Chương|Chap|Chapter|Hồi)\s*\d+[\s\S]*$/i, '').trim() || cleanPageTitle;
  let chapterTitle: string | undefined;

  const splitMatch = cleanPageTitle.match(/^(.*?)\s*[-–—:|]\s*((?:chương|chap|chapter|hồi)\s*\d+.*)$/i);
  if (splitMatch) {
    if (splitMatch[1].trim()) novelTitle = splitMatch[1].trim();
    chapterTitle = splitMatch[2].trim();
  }

  const chapHeading =
    doc.querySelector('.chapter-title, .truyen-title, .chap-title, h1, h2')?.textContent?.trim() || '';
  if (!chapterTitle && /(?:chương|chap|chapter|hồi)\s*\d+/i.test(chapHeading)) {
    chapterTitle = chapHeading.replace(/^(?:chương|chap|chapter|hồi)\s*\d+\s*[:.\-–—]?\s*/i, '').trim();
  }

  const ogDesc =
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
    `Đồng bộ trực tiếp từ ${parsedUrl.hostname}.`;

  const ogImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
    undefined;

  const authorMeta =
    doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
    doc.querySelector('[itemprop="author"]')?.textContent?.trim() ||
    parsedUrl.hostname.replace(/^www\./, '');

  const contentSelectors = [
    '#chapter-c',
    '.chapter-c',
    '#chapter-content',
    '.chapter-content',
    '.reader-content',
    '.vungdoc',
    '.box-chap',
    '.reading-content',
    'article',
    'main'
  ];

  let paragraphs: string[] = [];
  for (const sel of contentSelectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, nav, header, footer, button, a').forEach((n) => n.remove());
    const rawText = clone.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|blockquote|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    const lines = rawText
      .split(/\n+/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length >= 15);
    if (lines.length >= 3) {
      paragraphs = lines.slice(0, 240);
      break;
    }
  }

  const chapterLinks: { title: string; url: string; number?: number }[] = [];
  const seen = new Set<string>([normalizedUrl]);
  let nextChapterUrl: string | undefined;
  let nextChapterTitle: string | undefined;
  let firstChapterUrl: string | undefined;

  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')?.trim() || '';
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
    let resolved = '';
    try {
      resolved = new URL(href, normalizedUrl).toString();
    } catch {
      return;
    }
    if (resolved === normalizedUrl) return;
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    const cls = `${a.id || ''} ${a.className || ''}`;

    if (!firstChapterUrl && /^(?:đọc\s*từ\s*đầu|đọc\s*ngay|đọc\s*chương\s*1)$/i.test(text)) {
      firstChapterUrl = resolved;
    }

    if (
      !nextChapterUrl &&
      (/\b(?:next_chap|next-chap|btn-next|chap-next)\b/i.test(cls) ||
        /^(?:chương\s*(?:tiếp|sau|kế)|chap\s*(?:tiếp|sau)|next\s*chapter)$/i.test(text))
    ) {
      nextChapterUrl = resolved;
      nextChapterTitle = text;
      return;
    }

    const numMatch = text.match(/(?:chương|chap|chapter|hồi)\s*0*(\d+)/i) || href.match(/(?:chuong|chap|chapter)-0*(\d+)/i);
    if (numMatch && !seen.has(resolved) && chapterLinks.length < 100) {
      seen.add(resolved);
      const num = parseInt(numMatch[1], 10);
      chapterLinks.push({
        title: text.replace(/^(?:chương|chap|chapter|hồi)\s*\d+\s*[:.\-–—]?\s*/i, '').trim() || `Chương ${num}`,
        url: resolved,
        number: Number.isFinite(num) ? num : undefined
      });
    }
  });

  return {
    url: normalizedUrl,
    title: novelTitle || 'Truyện Đồng Bộ URL',
    chapterTitle,
    author: authorMeta,
    genre: 'Tiên Hiệp',
    synopsis: ogDesc.trim(),
    ...(ogImage ? { coverImageUrl: ogImage } : {}),
    ...(firstChapterUrl ? { firstChapterUrl } : {}),
    paragraphs,
    chapterLinks,
    nextChapterUrl,
    nextChapterTitle
  };
}

export function buildNovelFromClientExtraction(
  extracted: ClientExtractedUrlData,
  overrides: {
    title?: string;
    author?: string;
    genre?: string;
    synopsis?: string;
    coverStyle?: Novel['coverStyle'];
    coverImageUrl?: string;
    autoFetchEnabled?: boolean;
  }
): Novel {
  const finalTitle = overrides.title?.trim() || extracted.title || 'Truyện Đồng Bộ URL';
  const finalAuthor = overrides.author?.trim() || extracted.author || 'Nguồn Web';
  const finalGenre = overrides.genre?.trim() || extracted.genre || 'Tiên Hiệp';
  const finalSynopsis = overrides.synopsis?.trim() || extracted.synopsis;
  const finalCover = overrides.coverImageUrl?.trim() || extracted.coverImageUrl;

  const slugId =
    finalTitle
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
    '-' +
    Math.floor(100 + Math.random() * 900);

  const nowIso = new Date().toISOString();
  const paragraphs =
    extracted.paragraphs.length > 0
      ? extracted.paragraphs
      : [
          `Giữa thế giới "${finalTitle}", hành trình của tác giả ${finalAuthor} thuộc thể loại ${finalGenre} vừa chính thức khai mở.`,
          finalSynopsis
        ];

  const chapter1: Chapter = {
    id: `${slugId}-c1`,
    novelId: slugId,
    number: 1,
    title: extracted.chapterTitle || 'Khởi đầu hành trình',
    content: paragraphs,
    wordCount: countWordsClient(paragraphs),
    publishedAt: nowIso,
    sourceChapterUrl: extracted.url
  };

  const pendingLinks = extracted.chapterLinks.map((l) => ({ title: l.title, url: l.url }));
  if (extracted.nextChapterUrl && !pendingLinks.some((l) => l.url === extracted.nextChapterUrl)) {
    pendingLinks.unshift({
      title: extracted.nextChapterTitle || 'Chương 2',
      url: extracted.nextChapterUrl
    });
  }

  return {
    id: slugId,
    title: finalTitle,
    author: finalAuthor,
    genre: finalGenre,
    status: 'Đang ra',
    synopsis: finalSynopsis,
    coverStyle: overrides.coverStyle || 'star-nebula',
    ...(finalCover ? { coverImageUrl: finalCover } : {}),
    views: 1,
    rating: 5.0,
    updatedAt: nowIso,
    chapters: [chapter1],
    sourceUrl: extracted.parentBookUrl || extracted.url,
    autoFetchEnabled: overrides.autoFetchEnabled ?? true,
    lastSyncedAt: nowIso,
    pendingChapterLinks: pendingLinks
  };
}

