import React, { useState, useRef } from 'react';
import {
  X,
  Send,
  Sparkles,
  BookPlus,
  FilePlus,
  Globe,
  RefreshCw,
  CheckCircle2,
  ImagePlus,
  GitBranch,
  UploadCloud,
  DownloadCloud,
  ExternalLink,
  KeyRound
} from 'lucide-react';
import { Novel } from '../types';
import { BookCoverArtwork, compressBookCoverFile } from './BookCoverArtwork';
import {
  GitHubSyncConfig,
  GitHubPushResult,
  loadLocalGitHubConfig,
  saveLocalGitHubConfig,
  parseGitHubOwnerAndRepo,
  extractUrlClientSide
} from '../utils/githubSyncClient';

export type PublishModalMode = 'url' | 'novel' | 'chapter' | 'github';

export interface CreateNovelPayload {
  title: string;
  author: string;
  genre: string;
  synopsis: string;
  coverStyle: Novel['coverStyle'];
  coverImageUrl?: string;
  firstChapterTitle: string;
  firstChapterContent: string;
}

export interface ImportUrlPayload {
  url: string;
  title: string;
  author: string;
  genre: string;
  synopsis: string;
  coverStyle: Novel['coverStyle'];
  coverImageUrl?: string;
  autoFetchEnabled: boolean;
}

interface PublishChapterModalProps {
  isOpen: boolean;
  initialMode?: PublishModalMode;
  onClose: () => void;
  novels: Novel[];
  selectedNovelId?: string;
  onPublish: (novelId: string, title?: string, content?: string, chapterUrl?: string) => Promise<void>;
  onQuickAutoRelease: (novelId?: string) => Promise<void>;
  onCreateNovel: (payload: CreateNovelPayload) => Promise<Novel | void>;
  onImportUrlNovel: (payload: ImportUrlPayload) => Promise<Novel | void>;
  onPushToGitHub?: (configOverride?: Partial<GitHubSyncConfig>, commitMessage?: string) => Promise<GitHubPushResult>;
  onPullFromGitHub?: (configOverride?: Partial<GitHubSyncConfig>) => Promise<number>;
}

const COVER_OPTIONS: { id: Novel['coverStyle']; label: string }[] = [
  { id: 'ink-mountain', label: 'Thủy Mặc Sơn' },
  { id: 'imperial-moon', label: 'Nguyệt Thành' },
  { id: 'star-nebula', label: 'Tinh Hà' },
  { id: 'ancient-library', label: 'Tàng Thư Các' },
  { id: 'jade-bamboo', label: 'Trúc Lâm' },
  { id: 'crimson-blade', label: 'Huyết Kiếm' }
];

const GENRE_OPTIONS = ['Tiên Hiệp', 'Kỳ Ảo Cổ Phong', 'Khoa Huyễn', 'Huyền Huyễn', 'Đô Thị', 'Kiếm Hiệp'];

export const PublishChapterModal: React.FC<PublishChapterModalProps> = ({
  isOpen,
  initialMode = 'url',
  onClose,
  novels,
  selectedNovelId,
  onPublish,
  onQuickAutoRelease,
  onCreateNovel,
  onImportUrlNovel,
  onPushToGitHub,
  onPullFromGitHub
}) => {
  const [mode, setMode] = useState<PublishModalMode>(initialMode);

  // URL Import state
  const [sourceUrl, setSourceUrl] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [urlAuthor, setUrlAuthor] = useState('');
  const [urlGenre, setUrlGenre] = useState(GENRE_OPTIONS[0]);
  const [urlSynopsis, setUrlSynopsis] = useState('');
  const [urlCoverStyle, setUrlCoverStyle] = useState<Novel['coverStyle']>('star-nebula');
  const [urlCoverImage, setUrlCoverImage] = useState<string>('');
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(true);
  const [analyzingUrl, setAnalyzingUrl] = useState(false);
  const [detectedCount, setDetectedCount] = useState<number | null>(null);
  const [detectedParagraphCount, setDetectedParagraphCount] = useState<number | null>(null);
  const urlCoverInputRef = useRef<HTMLInputElement | null>(null);

  // Manual Novel state
  const [newTitle, setNewTitle] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [newGenre, setNewGenre] = useState(GENRE_OPTIONS[0]);
  const [newSynopsis, setNewSynopsis] = useState('');
  const [newCoverStyle, setNewCoverStyle] = useState<Novel['coverStyle']>('ink-mountain');
  const [newCoverImage, setNewCoverImage] = useState<string>('');
  const [firstChapTitle, setFirstChapTitle] = useState('');
  const [firstChapContent, setFirstChapContent] = useState('');
  const novelCoverInputRef = useRef<HTMLInputElement | null>(null);

  // Chapter state
  const [novelId, setNovelId] = useState<string>(selectedNovelId || novels[0]?.id || '');
  const [chapterUrlInput, setChapterUrlInput] = useState('');
  const [scanningChapterUrl, setScanningChapterUrl] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterContent, setChapterContent] = useState('');

  // GitHub Sync state
  const [ghConfig, setGhConfig] = useState<GitHubSyncConfig>(() => loadLocalGitHubConfig());
  const [ghCommitMsg, setGhCommitMsg] = useState('');
  const [ghPushing, setGhPushing] = useState(false);
  const [ghPulling, setGhPulling] = useState(false);
  const [ghSuccessBanner, setGhSuccessBanner] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMsg('');
      setGhSuccessBanner(null);
      setGhConfig(loadLocalGitHubConfig());
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const activeNovelId = novelId || novels[0]?.id || '';
  const targetNovel = novels.find((n) => n.id === activeNovelId);
  const nextChapterNum = targetNovel
    ? Math.max(
        targetNovel.chapters.length,
        ...targetNovel.chapters.map((c) => Number(c.number) || 0)
      ) + 1
    : 1;

  const updateGhConfigField = (partial: Partial<GitHubSyncConfig>) => {
    setGhConfig((prev) => {
      const next = saveLocalGitHubConfig({ ...prev, ...partial });
      return next;
    });
  };

  const handleSelectUrlCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressBookCoverFile(file);
      setUrlCoverImage(dataUrl);
    } catch {
      // ignore
    } finally {
      e.target.value = '';
    }
  };

  const handleSelectNovelCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressBookCoverFile(file);
      setNewCoverImage(dataUrl);
    } catch {
      // ignore
    } finally {
      e.target.value = '';
    }
  };

  const handleAnalyzeUrl = async (targetUrl?: string) => {
    const urlToScan = (targetUrl ?? sourceUrl).trim();
    if (!urlToScan) {
      setErrorMsg('Vui lòng nhập đường dẫn URL của truyện.');
      return;
    }
    setAnalyzingUrl(true);
    setErrorMsg('');
    try {
      let data: {
        url?: string;
        title?: string;
        author?: string;
        genre?: string;
        synopsis?: string;
        coverImageUrl?: string;
        chapterLinks?: { title: string; url: string; number?: number }[];
        nextChapterUrl?: string;
        firstChapterUrl?: string;
        paragraphs?: string[];
        error?: string;
      } | null = null;

      try {
        const res = await fetch('/api/novels/preview-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlToScan })
        });
        if (res.ok) {
          data = await res.json();
        }
      } catch {
        // Fallback to client-side extraction when running on static Vercel host
      }

      if (!data) {
        data = await extractUrlClientSide(urlToScan);
      }

      setSourceUrl(data.url || urlToScan);
      if (data.title) setUrlTitle(data.title);
      if (data.author) setUrlAuthor(data.author);
      if (data.genre && GENRE_OPTIONS.includes(data.genre)) {
        setUrlGenre(data.genre);
      }
      if (data.synopsis) setUrlSynopsis(data.synopsis);
      if (data.coverImageUrl && !urlCoverImage) {
        setUrlCoverImage(data.coverImageUrl);
      }
      const linksCount = Array.isArray(data.chapterLinks) ? data.chapterLinks.length : 0;
      const hasNext = Boolean(data.nextChapterUrl || data.firstChapterUrl);
      setDetectedCount(Math.max(1, linksCount + (hasNext && linksCount === 0 ? 2 : 1)));
      setDetectedParagraphCount(
        Array.isArray(data.paragraphs) && data.paragraphs.length > 0 ? data.paragraphs.length : null
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Không thể phân tích đường dẫn URL này.'
      );
    } finally {
      setAnalyzingUrl(false);
    }
  };

  const handleScanChapterUrl = async () => {
    const urlToScan = chapterUrlInput.trim();
    if (!urlToScan) {
      setErrorMsg('Vui lòng nhập đường dẫn URL của chương truyện cần lấy.');
      return;
    }
    setScanningChapterUrl(true);
    setErrorMsg('');
    try {
      let data: {
        chapterTitle?: string;
        title?: string;
        paragraphs?: string[];
        error?: string;
      } | null = null;

      try {
        const res = await fetch('/api/novels/preview-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlToScan })
        });
        if (res.ok) {
          data = await res.json();
        }
      } catch {
        // Fallback to client-side extraction on Vercel static hosting
      }

      if (!data) {
        data = await extractUrlClientSide(urlToScan);
      }

      if (data.chapterTitle || data.title) {
        setChapterTitle(data.chapterTitle || data.title || '');
      }
      if (Array.isArray(data.paragraphs) && data.paragraphs.length > 0) {
        setChapterContent(data.paragraphs.join('\n\n'));
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Lỗi kết nối khi bóc tách nội dung chương.'
      );
    } finally {
      setScanningChapterUrl(false);
    }
  };

  const handleUrlImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceUrl.trim()) {
      setErrorMsg('Vui lòng nhập địa chỉ URL nguồn truyện.');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      await onImportUrlNovel({
        url: sourceUrl.trim(),
        title: urlTitle.trim(),
        author: urlAuthor.trim(),
        genre: urlGenre,
        synopsis: urlSynopsis.trim(),
        coverStyle: urlCoverStyle,
        ...(urlCoverImage ? { coverImageUrl: urlCoverImage } : {}),
        autoFetchEnabled
      });
      setSourceUrl('');
      setUrlTitle('');
      setUrlAuthor('');
      setUrlSynopsis('');
      setUrlCoverImage('');
      setDetectedCount(null);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleNovelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setErrorMsg('Vui lòng nhập tên tác phẩm.');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      await onCreateNovel({
        title: newTitle.trim(),
        author: newAuthor.trim() || 'Ẩn Danh',
        genre: newGenre,
        synopsis: newSynopsis.trim(),
        coverStyle: newCoverStyle,
        ...(newCoverImage ? { coverImageUrl: newCoverImage } : {}),
        firstChapterTitle: firstChapTitle.trim(),
        firstChapterContent: firstChapContent.trim()
      });
      setNewTitle('');
      setNewAuthor('');
      setNewSynopsis('');
      setNewCoverImage('');
      setFirstChapTitle('');
      setFirstChapContent('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleChapterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeNovelId || submitting) return;
    setSubmitting(true);
    try {
      await onPublish(activeNovelId, chapterTitle, chapterContent, chapterUrlInput.trim() || undefined);
      setChapterTitle('');
      setChapterContent('');
      setChapterUrlInput('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickRelease = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onQuickAutoRelease(activeNovelId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualGitHubPush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onPushToGitHub || ghPushing) return;
    const { owner, repo } = parseGitHubOwnerAndRepo(ghConfig.owner, ghConfig.repo);
    if (!ghConfig.token.trim() || !owner || !repo) {
      setErrorMsg('Vui lòng nhập đầy đủ GitHub Token, Owner (Username) và Tên Repository.');
      return;
    }
    const normalizedCfg = saveLocalGitHubConfig({
      ...ghConfig,
      owner,
      repo,
      branch: (ghConfig.branch || 'main').trim() || 'main'
    });
    setGhConfig(normalizedCfg);
    setGhPushing(true);
    setErrorMsg('');
    setGhSuccessBanner(null);

    try {
      const result = await onPushToGitHub(normalizedCfg, ghCommitMsg.trim() || undefined);
      if (result.success) {
        setGhConfig(loadLocalGitHubConfig());
        setGhCommitMsg('');
        setGhSuccessBanner(
          `Đã đồng bộ thành công ${novels.length} truyện (${result.filesCount || 1} tệp trong data/ & novels/) lên nhánh ${normalizedCfg.branch}! Vercel sẽ tự động cập nhật.`
        );
      } else {
        setErrorMsg(result.error || 'Không thể đẩy dữ liệu lên GitHub.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi kết nối GitHub.');
    } finally {
      setGhPushing(false);
    }
  };

  const handleManualGitHubPull = async () => {
    if (!onPullFromGitHub || ghPulling) return;
    const { owner, repo } = parseGitHubOwnerAndRepo(ghConfig.owner, ghConfig.repo);
    if (!owner || !repo) {
      setErrorMsg('Vui lòng nhập Owner (Username) và Tên Repository trước khi tải.');
      return;
    }
    const normalizedCfg = saveLocalGitHubConfig({
      ...ghConfig,
      owner,
      repo,
      branch: (ghConfig.branch || 'main').trim() || 'main'
    });
    setGhConfig(normalizedCfg);
    setGhPulling(true);
    setErrorMsg('');
    setGhSuccessBanner(null);

    try {
      const count = await onPullFromGitHub(normalizedCfg);
      if (count > 0) {
        setGhSuccessBanner(`Đã nạp thành công ${count} truyện từ kho GitHub (${owner}/${repo})!`);
      } else {
        setErrorMsg('Chưa tìm thấy dữ liệu truyện trong data/synced-novels.json trên nhánh này.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi tải dữ liệu từ GitHub.');
    } finally {
      setGhPulling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[#FBF9F5] dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xl overflow-hidden">
        {/* Header with 4-Tab Mode Switcher */}
        <div className="px-5 pt-4 pb-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 bg-stone-200/70 dark:bg-stone-950 rounded-xl overflow-x-auto">
            <button
              type="button"
              onClick={() => {
                setMode('url');
                setErrorMsg('');
              }}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'url'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white shadow-2xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              <span>Nhập Từ URL</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('novel');
                setErrorMsg('');
              }}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'novel'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white shadow-2xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <BookPlus className="w-3.5 h-3.5" />
              <span>Tự Viết Truyện</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('chapter');
                setErrorMsg('');
              }}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'chapter'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white shadow-2xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <FilePlus className="w-3.5 h-3.5" />
              <span>Đăng Chương</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('github');
                setErrorMsg('');
                setGhConfig(loadLocalGitHubConfig());
              }}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'github'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white shadow-2xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              <span>Đồng Bộ GitHub</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg transition-colors cursor-pointer shrink-0"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-6">
          {errorMsg && (
            <div className="mb-4 text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 rounded-xl">
              {errorMsg}
            </div>
          )}

          {mode === 'url' && (
            <form onSubmit={handleUrlImportSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  Đường dẫn URL truyện hoặc RSS Feed <span className="text-amber-700">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://truyenfull.vn/... hoặc link trang truyện bất kỳ"
                    className="flex-1 h-10 px-3.5 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                  />
                  <button
                    type="button"
                    disabled={analyzingUrl}
                    onClick={() => handleAnalyzeUrl()}
                    className="h-10 px-3.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-xs font-medium text-stone-800 dark:text-stone-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${analyzingUrl ? 'animate-spin' : ''}`} />
                    <span>{analyzingUrl ? 'Đang quét...' : 'Quét thông tin'}</span>
                  </button>
                </div>
              </div>

              {detectedCount !== null && (
                <div className="px-3.5 py-2.5 rounded-xl bg-emerald-900/10 dark:bg-emerald-500/10 border border-emerald-700/25 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Đã bóc tách chuẩn dữ liệu từ URL ({detectedCount} chương được phát hiện
                    {detectedParagraphCount ? ` · ${detectedParagraphCount} đoạn văn ở trang đầu` : ''}).
                  </span>
                </div>
              )}

              {/* Cover Preview + Extracted Metadata */}
              <div className="flex flex-col sm:flex-row gap-5 items-start pt-1">
                <div className="w-28 shrink-0 mx-auto sm:mx-0">
                  <BookCoverArtwork
                    styleType={urlCoverStyle}
                    coverImageUrl={urlCoverImage}
                    title={urlTitle.trim() || 'Truyện Từ URL'}
                    author={urlAuthor.trim() || 'Nguồn Web'}
                    onUploadCoverImage={(dataUrl) => setUrlCoverImage(dataUrl)}
                    className="w-full aspect-[3/4] rounded-lg"
                  />
                </div>

                <div className="flex-1 w-full space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                      Tên truyện (Tự động điền sau khi quét hoặc tự sửa)
                    </label>
                    <input
                      type="text"
                      value={urlTitle}
                      onChange={(e) => setUrlTitle(e.target.value)}
                      placeholder="Sẽ tự động lấy từ tiêu đề trang web..."
                      className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                        Tác giả / Nguồn
                      </label>
                      <input
                        type="text"
                        value={urlAuthor}
                        onChange={(e) => setUrlAuthor(e.target.value)}
                        placeholder="Tự động nhận diện..."
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                        Thể loại
                      </label>
                      <select
                        value={urlGenre}
                        onChange={(e) => setUrlGenre(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                      >
                        {GENRE_OPTIONS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Book Cover Selection + Gallery Upload Button */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
                    Bìa giao diện sách
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={urlCoverInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleSelectUrlCoverFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => urlCoverInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ImagePlus className="w-3.5 h-3.5 shrink-0" />
                      <span>Lấy ảnh từ thư viện làm giao diện sách</span>
                    </button>
                    {urlCoverImage && (
                      <button
                        type="button"
                        onClick={() => setUrlCoverImage('')}
                        className="px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        Dùng bìa vẽ sẵn
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {COVER_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setUrlCoverStyle(opt.id);
                        setUrlCoverImage('');
                      }}
                      className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium transition-all cursor-pointer truncate ${
                        !urlCoverImage && urlCoverStyle === opt.id
                          ? 'border-amber-700 bg-amber-900/10 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300'
                          : 'border-stone-300 dark:border-stone-800 text-stone-600 dark:text-stone-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                  Mô tả tóm tắt
                </label>
                <textarea
                  rows={2}
                  value={urlSynopsis}
                  onChange={(e) => setUrlSynopsis(e.target.value)}
                  placeholder="Mô tả được trích xuất từ thẻ meta của URL..."
                  className="w-full p-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 leading-relaxed"
                />
              </div>

              {/* Auto-Fetch Toggle */}
              <div className="p-3.5 rounded-xl bg-stone-200/50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                    Tự động quét & lấy chương mới theo thời gian thực
                  </p>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                    Máy chủ tự động kiểm tra URL định kỳ mỗi 35 giây và đẩy chương mới qua WebSocket
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoFetchEnabled((v) => !v)}
                  className={`min-h-[32px] px-3 rounded-lg text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                    autoFetchEnabled
                      ? 'bg-amber-800 dark:bg-amber-600 text-white'
                      : 'bg-stone-300 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {autoFetchEnabled ? 'Đang bật' : 'Tắt'}
                </button>
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[40px] px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-5 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-medium flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <Globe className="w-4 h-4" />
                  <span>{submitting ? 'Đang đồng bộ...' : 'Kết Nối URL & Tự Động Lấy Chương'}</span>
                </button>
              </div>
            </form>
          )}

          {mode === 'novel' && (
            <form onSubmit={handleNovelSubmit} className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-5 items-start">
                <div className="w-28 shrink-0 mx-auto sm:mx-0">
                  <BookCoverArtwork
                    styleType={newCoverStyle}
                    coverImageUrl={newCoverImage}
                    title={newTitle.trim() || 'Tên Tác Phẩm'}
                    author={newAuthor.trim() || 'Tác Giả'}
                    onUploadCoverImage={(dataUrl) => setNewCoverImage(dataUrl)}
                    className="w-full aspect-[3/4] rounded-lg"
                  />
                </div>

                <div className="flex-1 w-full space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                      Tên truyện <span className="text-amber-700">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Nhập tên tác phẩm mới..."
                      className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                        Bút danh tác giả
                      </label>
                      <input
                        type="text"
                        value={newAuthor}
                        onChange={(e) => setNewAuthor(e.target.value)}
                        placeholder="Ví dụ: Mặc Khách..."
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                        Thể loại
                      </label>
                      <select
                        value={newGenre}
                        onChange={(e) => setNewGenre(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                      >
                        {GENRE_OPTIONS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
                    Bìa giao diện sách
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={novelCoverInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleSelectNovelCoverFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => novelCoverInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-amber-800 hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ImagePlus className="w-3.5 h-3.5 shrink-0" />
                      <span>Lấy ảnh từ thư viện làm giao diện sách</span>
                    </button>
                    {newCoverImage && (
                      <button
                        type="button"
                        onClick={() => setNewCoverImage('')}
                        className="px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        Dùng bìa vẽ sẵn
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {COVER_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setNewCoverStyle(opt.id);
                        setNewCoverImage('');
                      }}
                      className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium transition-all cursor-pointer truncate ${
                        !newCoverImage && newCoverStyle === opt.id
                          ? 'border-amber-700 bg-amber-900/10 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300'
                          : 'border-stone-300 dark:border-stone-800 text-stone-600 dark:text-stone-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                  Giới thiệu tóm tắt (Văn án)
                </label>
                <textarea
                  rows={2}
                  value={newSynopsis}
                  onChange={(e) => setNewSynopsis(e.target.value)}
                  placeholder="Tóm tắt nội dung chính hoặc bối cảnh của truyện..."
                  className="w-full p-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 leading-relaxed"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 space-y-3">
                <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                  Nội dung Chương 1 mở đầu (Tùy chọn)
                </p>

                <input
                  type="text"
                  value={firstChapTitle}
                  onChange={(e) => setFirstChapTitle(e.target.value)}
                  placeholder="Tiêu đề Chương 1 (Ví dụ: Khởi đầu phong vân)"
                  className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                />

                <textarea
                  rows={3}
                  value={firstChapContent}
                  onChange={(e) => setFirstChapContent(e.target.value)}
                  placeholder="Nhập nội dung chương mở đầu..."
                  className="w-full p-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 leading-relaxed"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[40px] px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium text-stone-600 dark:text-stone-400 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[40px] px-5 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-medium flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <BookPlus className="w-4 h-4" />
                  <span>Tạo Truyện Mới</span>
                </button>
              </div>
            </form>
          )}

          {mode === 'chapter' && (
            novels.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-sm text-stone-600 dark:text-stone-300">
                  Chưa có tác phẩm nào trong kho truyện để đăng chương.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('url')}
                    className="px-4 py-2 rounded-lg bg-amber-800 dark:bg-amber-600 text-white text-xs font-semibold cursor-pointer"
                  >
                    Nhập truyện từ URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('novel')}
                    className="px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-semibold text-stone-800 dark:text-stone-200 cursor-pointer"
                  >
                    Tạo truyện mới
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleChapterSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  Chọn tác phẩm cần thêm chương
                </label>
                <select
                  value={activeNovelId}
                  onChange={(e) => setNovelId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                >
                  {novels.map((novel) => (
                    <option key={novel.id} value={novel.id}>
                      {novel.title} (Hiện tại: {novel.chapters.length} chương)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  Lấy trực tiếp nội dung từ URL chương truyện (Tùy chọn)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chapterUrlInput}
                    onChange={(e) => setChapterUrlInput(e.target.value)}
                    placeholder="Dán link chương truyện (TruyenFull, Metruyenchu, Tangthuvien...)"
                    className="flex-1 h-10 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                  />
                  <button
                    type="button"
                    disabled={scanningChapterUrl}
                    onClick={handleScanChapterUrl}
                    className="h-10 px-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-xs font-medium text-stone-800 dark:text-stone-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${scanningChapterUrl ? 'animate-spin' : ''}`} />
                    <span>{scanningChapterUrl ? 'Đang lấy...' : 'Quét chương'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  Tiêu đề Chương {nextChapterNum} (Để trống nếu muốn lấy tự động)
                </label>
                <input
                  type="text"
                  value={chapterTitle}
                  onChange={(e) => setChapterTitle(e.target.value)}
                  placeholder={`Ví dụ: Biến cố mới tại chương ${nextChapterNum}...`}
                  className="w-full h-10 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  Nội dung chương (Để trống để tự động đồng bộ từ nguồn hoặc biên soạn chương kế tiếp)
                </label>
                <textarea
                  rows={4}
                  value={chapterContent}
                  onChange={(e) => setChapterContent(e.target.value)}
                  placeholder="Nhập nội dung chương truyện, quét từ URL bên trên, hoặc bấm nút lấy tự động bên dưới..."
                  className="w-full p-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 leading-relaxed"
                />
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={handleQuickRelease}
                  disabled={submitting}
                  className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 text-xs font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-700 dark:text-amber-500" />
                  <span>Lấy chương mới tự động ngay</span>
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:flex-1 min-h-[40px] px-5 py-2 rounded-lg bg-amber-800 hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Đăng Chương {nextChapterNum}</span>
                </button>
              </div>
            </form>
            )
          )}

          {mode === 'github' && (
            <form onSubmit={handleManualGitHubPush} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-900/10 dark:bg-amber-500/10 border border-amber-800/25 dark:border-amber-500/25 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                    <GitBranch className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                    <span>Đồng Bộ Truyện & Chương Lên GitHub (Hỗ Trợ Web Online Vercel)</span>
                  </p>
                  <span className="text-[11px] font-mono-num px-2 py-0.5 rounded bg-amber-800/15 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 font-semibold shrink-0">
                    {novels.length} truyện · {novels.reduce((s, n) => s + (n.chapters?.length || 0), 0)} chương
                  </span>
                </div>
                <p className="text-[11px] text-stone-600 dark:text-stone-300 leading-relaxed">
                  Khi đẩy lên GitHub, hệ thống tự động ghi trực tiếp vào <code className="font-mono-num px-1 py-0.5 rounded bg-stone-200/80 dark:bg-stone-800">data/synced-novels.json</code> và thư mục <code className="font-mono-num px-1 py-0.5 rounded bg-stone-200/80 dark:bg-stone-800">novels/&lt;slug&gt;/chapters/</code> trên repo của bạn để Vercel tự động build & hiển thị cho mọi độc giả.
                </p>
              </div>

              {ghSuccessBanner && (
                <div className="px-3.5 py-2.5 rounded-xl bg-emerald-900/10 dark:bg-emerald-500/15 border border-emerald-700/30 flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0 flex-1">
                    <p>{ghSuccessBanner}</p>
                    {ghConfig.lastCommitUrl && (
                      <a
                        href={ghConfig.lastCommitUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline hover:opacity-80"
                      >
                        <span>Xem Commit trên GitHub ({ghConfig.lastCommitSha?.slice(0, 7)})</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                    GitHub Owner / Username <span className="text-amber-700">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={ghConfig.owner}
                    onChange={(e) => updateGhConfigField({ owner: e.target.value })}
                    placeholder="VD: ten-tai-khoan"
                    className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Tên Repository (hoặc URL) <span className="text-amber-700">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={ghConfig.repo}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.includes('github.com/')) {
                        const parsed = parseGitHubOwnerAndRepo(ghConfig.owner, val);
                        updateGhConfigField({ owner: parsed.owner, repo: parsed.repo });
                      } else {
                        updateGhConfigField({ repo: val });
                      }
                    }}
                    placeholder="VD: mac-thu-cac"
                    className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Nhánh (Branch)
                  </label>
                  <input
                    type="text"
                    value={ghConfig.branch}
                    onChange={(e) => updateGhConfigField({ branch: e.target.value })}
                    placeholder="main"
                    className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 font-mono-num"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                  GitHub Personal Access Token (Quyền <code className="font-mono-num">repo</code> hoặc <code className="font-mono-num">contents:write</code>) <span className="text-amber-700">*</span>
                </label>
                <div className="relative">
                  <KeyRound className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    required
                    value={ghConfig.token}
                    onChange={(e) => updateGhConfigField({ token: e.target.value })}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full h-9 pl-8 pr-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700 font-mono-num"
                  />
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
                  Token được lưu cục bộ trên trình duyệt của bạn để tự động commit trực tiếp lên GitHub kể cả khi chạy trên Vercel.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                  Nội dung Commit (Tùy chọn)
                </label>
                <input
                  type="text"
                  value={ghCommitMsg}
                  onChange={(e) => setGhCommitMsg(e.target.value)}
                  placeholder={`chore(sync): đồng bộ ${novels.length} truyện lên GitHub`}
                  className="w-full h-9 px-3 rounded-lg bg-white dark:bg-stone-950 border border-stone-300 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                />
              </div>

              {/* Auto-Push Toggle */}
              <div className="p-3.5 rounded-xl bg-stone-200/50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                    Tự động đồng bộ lên GitHub mỗi khi thêm truyện hoặc chương mới
                  </p>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                    Mỗi khi bạn nhập URL, tạo truyện mới hoặc đăng chương mới, web sẽ tự động commit lên GitHub
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateGhConfigField({ autoPush: !ghConfig.autoPush })}
                  className={`min-h-[32px] px-3 rounded-lg text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                    ghConfig.autoPush
                      ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
                      : 'bg-stone-300 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {ghConfig.autoPush ? 'Đang bật' : 'Tắt'}
                </button>
              </div>

              {ghConfig.lastPushAt && (
                <div className="px-3.5 py-2 rounded-xl bg-stone-200/40 dark:bg-stone-950/70 border border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-600 dark:text-stone-400">
                  <span>
                    Lần đồng bộ gần nhất:{' '}
                    <strong className="font-mono-num text-stone-800 dark:text-stone-200">
                      {new Date(ghConfig.lastPushAt).toLocaleString('vi-VN')}
                    </strong>
                  </span>
                  {ghConfig.lastCommitUrl && (
                    <a
                      href={ghConfig.lastCommitUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-800 dark:text-amber-400 font-semibold hover:underline flex items-center gap-1"
                    >
                      <span>Commit {ghConfig.lastCommitSha?.slice(0, 7)}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2.5">
                <button
                  type="button"
                  disabled={ghPulling || ghPushing}
                  onClick={handleManualGitHubPull}
                  className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <DownloadCloud className={`w-4 h-4 ${ghPulling ? 'animate-bounce' : ''}`} />
                  <span>{ghPulling ? 'Đang tải từ GitHub...' : 'Tải Dữ Liệu Từ GitHub'}</span>
                </button>

                <button
                  type="submit"
                  disabled={ghPushing || ghPulling}
                  className="w-full sm:flex-1 min-h-[40px] px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <UploadCloud className={`w-4 h-4 ${ghPushing ? 'animate-bounce' : ''}`} />
                  <span>
                    {ghPushing
                      ? 'Đang đồng bộ lên GitHub...'
                      : `Đẩy ${novels.length} Truyện Lên GitHub Ngay`}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
