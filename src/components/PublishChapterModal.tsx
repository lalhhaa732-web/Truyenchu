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
  ImagePlus
} from 'lucide-react';
import { Novel } from '../types';
import { BookCoverArtwork, compressBookCoverFile } from './BookCoverArtwork';

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
  initialMode?: 'url' | 'novel' | 'chapter';
  onClose: () => void;
  novels: Novel[];
  selectedNovelId?: string;
  onPublish: (novelId: string, title?: string, content?: string, chapterUrl?: string) => Promise<void>;
  onQuickAutoRelease: (novelId?: string) => Promise<void>;
  onCreateNovel: (payload: CreateNovelPayload) => Promise<Novel | void>;
  onImportUrlNovel: (payload: ImportUrlPayload) => Promise<Novel | void>;
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
  onImportUrlNovel
}) => {
  const [mode, setMode] = useState<'url' | 'novel' | 'chapter'>(initialMode);

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

  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setErrorMsg('');
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
      const res = await fetch('/api/novels/preview-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToScan })
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Không thể phân tích đường dẫn này.');
        return;
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
    } catch {
      setErrorMsg('Lỗi kết nối máy chủ khi phân tích URL.');
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
      const res = await fetch('/api/novels/preview-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToScan })
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Không thể bóc tách nội dung chương từ URL này.');
        return;
      }
      if (data.chapterTitle || data.title) {
        setChapterTitle(data.chapterTitle || data.title);
      }
      if (Array.isArray(data.paragraphs) && data.paragraphs.length > 0) {
        setChapterContent(data.paragraphs.join('\n\n'));
      }
    } catch {
      setErrorMsg('Lỗi kết nối khi bóc tách nội dung chương.');
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[#FBF9F5] dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xl overflow-hidden">
        {/* Header with 3-Tab Mode Switcher */}
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
        </div>
      </div>
    </div>
  );
};
