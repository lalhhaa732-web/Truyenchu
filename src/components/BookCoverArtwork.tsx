import React, { useRef, useState, useEffect } from 'react';
import { ImagePlus, Palette, X, Check, RotateCcw, Sparkles } from 'lucide-react';
import { Novel } from '../types';

export const COVER_STYLE_OPTIONS: {
  id: Novel['coverStyle'];
  label: string;
  subtitle: string;
}[] = [
  { id: 'ink-mountain', label: 'Thủy Mặc Sơn', subtitle: 'Núi mờ sương & kiếm khí' },
  { id: 'imperial-moon', label: 'Nguyệt Thành', subtitle: 'Hoàng cung dưới trăng vàng' },
  { id: 'star-nebula', label: 'Tinh Hà', subtitle: 'Vũ trụ tinh vân huyền ảo' },
  { id: 'ancient-library', label: 'Tàng Thư Các', subtitle: 'Pháp trận cổ thư hoàng kim' },
  { id: 'jade-bamboo', label: 'Trúc Lâm', subtitle: 'Rừng trúc ngọc bích thanh u' },
  { id: 'crimson-blade', label: 'Huyết Kiếm', subtitle: 'Huyết nguyệt & kiếm đạo' }
];

export function compressBookCoverFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // High-clarity 3:4 book cover resolution
        const targetW = 360;
        const targetH = 480;
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        const targetRatio = targetW / targetH;
        const srcRatio = img.width / img.height;
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;

        if (srcRatio > targetRatio) {
          sw = img.height * targetRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / targetRatio;
          sy = (img.height - sh) / 2;
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  });
}

interface BookCoverArtworkProps {
  styleType: Novel['coverStyle'];
  coverImageUrl?: string;
  title: string;
  author: string;
  genre?: string;
  className?: string;
  compact?: boolean;
  onUploadCoverImage?: (dataUrl: string) => void;
  onOpenCoverEditor?: () => void;
}

export const BookCoverArtwork: React.FC<BookCoverArtworkProps> = ({
  styleType,
  coverImageUrl,
  title,
  author,
  genre,
  className = '',
  compact = false,
  onUploadCoverImage,
  onOpenCoverEditor
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (!file || !onUploadCoverImage) return;
    try {
      const dataUrl = await compressBookCoverFile(file);
      onUploadCoverImage(dataUrl);
    } catch {
      // ignore invalid image
    } finally {
      e.target.value = '';
    }
  };

  const renderIllustration = () => {
    if (coverImageUrl) {
      return (
        <div className="relative w-full h-full overflow-hidden">
          <img
            src={coverImageUrl}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          {/* Subtle top & inner vignette so custom library photo blends into 3D book cover */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/75 pointer-events-none" />
          <svg
            viewBox="0 0 240 340"
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden="true"
          >
            <rect
              x="12"
              y="10"
              width="218"
              height="320"
              rx="4"
              fill="none"
              stroke="#fde68a"
              strokeOpacity="0.38"
              strokeWidth="1"
            />
            <rect
              x="16"
              y="14"
              width="210"
              height="312"
              rx="2"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.18"
              strokeWidth="0.6"
            />
          </svg>
        </div>
      );
    }

    switch (styleType) {
      case 'ink-mountain':
        return (
          <svg viewBox="0 0 240 340" className="w-full h-full object-cover" aria-hidden="true">
            <defs>
              <linearGradient id="bg-ink" x1="0" y1="0" x2="0.2" y2="1">
                <stop offset="0%" stopColor="#0f172a" />
                <stop offset="48%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#020617" />
              </linearGradient>
              <radialGradient id="moon-ink" cx="0.72" cy="0.22" r="0.38">
                <stop offset="0%" stopColor="#fef08a" stopOpacity="0.95" />
                <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="240" height="340" fill="url(#bg-ink)" />
            <circle cx="172" cy="74" r="72" fill="url(#moon-ink)" />
            <circle cx="172" cy="74" r="25" fill="#fef9c3" fillOpacity="0.94" />
            {/* Layered misty peaks */}
            <path d="M0 198 Q62 150 118 182 T240 156 L240 340 L0 340 Z" fill="#475569" fillOpacity="0.35" />
            <path d="M0 232 L64 142 L134 212 L198 126 L240 178 L240 340 L0 340 Z" fill="#1e293b" fillOpacity="0.88" />
            <path d="M0 272 L94 178 L168 246 L240 188 L240 340 L0 340 Z" fill="#090d16" />
            {/* Flying sword light */}
            <path d="M44 92 L138 48" stroke="#bae6fd" strokeOpacity="0.65" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="138" cy="48" r="2.2" fill="#fef08a" />
            {/* Oriental Gilded Frame */}
            <rect x="13" y="11" width="215" height="318" rx="4" fill="none" stroke="#94a3b8" strokeOpacity="0.38" strokeWidth="1" />
            <rect x="17" y="15" width="207" height="310" rx="2" fill="none" stroke="#e2e8f0" strokeOpacity="0.16" strokeWidth="0.6" />
          </svg>
        );
      case 'imperial-moon':
        return (
          <svg viewBox="0 0 240 340" className="w-full h-full object-cover" aria-hidden="true">
            <defs>
              <linearGradient id="bg-imperial" x1="0" y1="0" x2="0.6" y2="1">
                <stop offset="0%" stopColor="#1c1917" />
                <stop offset="50%" stopColor="#78350f" />
                <stop offset="100%" stopColor="#0c0a09" />
              </linearGradient>
              <radialGradient id="glow-imperial" cx="0.5" cy="0.28" r="0.42">
                <stop offset="0%" stopColor="#fde68a" stopOpacity="0.92" />
                <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#451a03" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="240" height="340" fill="url(#bg-imperial)" />
            <circle cx="124" cy="94" r="80" fill="url(#glow-imperial)" />
            <circle cx="124" cy="94" r="33" fill="#fef3c7" fillOpacity="0.94" />
            {/* Imperial Pavilion Roofs */}
            <path d="M24 226 Q124 182 220 226 L232 240 L12 240 Z" fill="#292524" stroke="#f59e0b" strokeOpacity="0.42" strokeWidth="0.9" />
            <path d="M48 196 Q124 162 198 196 L208 208 L38 208 Z" fill="#1c1917" stroke="#fbbf24" strokeOpacity="0.48" strokeWidth="0.9" />
            <rect x="54" y="240" width="138" height="100" fill="#0c0a09" />
            <rect x="13" y="11" width="215" height="318" rx="4" fill="none" stroke="#fbbf24" strokeOpacity="0.45" strokeWidth="1" />
            <rect x="17" y="15" width="207" height="310" rx="2" fill="none" stroke="#fde68a" strokeOpacity="0.22" strokeWidth="0.6" />
          </svg>
        );
      case 'star-nebula':
        return (
          <svg viewBox="0 0 240 340" className="w-full h-full object-cover" aria-hidden="true">
            <defs>
              <linearGradient id="bg-star" x1="0" y1="0" x2="0.4" y2="1">
                <stop offset="0%" stopColor="#090d16" />
                <stop offset="50%" stopColor="#31104b" />
                <stop offset="100%" stopColor="#020617" />
              </linearGradient>
              <radialGradient id="nebula-core" cx="0.5" cy="0.36" r="0.44">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.75" />
                <stop offset="55%" stopColor="#a855f7" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#090d16" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="240" height="340" fill="url(#bg-star)" />
            <circle cx="124" cy="120" r="90" fill="url(#nebula-core)" />
            <ellipse cx="124" cy="120" rx="76" ry="25" fill="none" stroke="#38bdf8" strokeOpacity="0.55" strokeWidth="1.2" transform="rotate(-24 124 120)" />
            <ellipse cx="124" cy="120" rx="48" ry="16" fill="none" stroke="#facc15" strokeOpacity="0.65" strokeWidth="0.9" transform="rotate(-24 124 120)" />
            <circle cx="124" cy="120" r="9.5" fill="#e0f2fe" />
            <circle cx="52" cy="56" r="1.6" fill="#ffffff" fillOpacity="0.85" />
            <circle cx="186" cy="72" r="2.1" fill="#fde68a" fillOpacity="0.9" />
            <circle cx="72" cy="185" r="1.5" fill="#c084fc" fillOpacity="0.85" />
            <rect x="13" y="11" width="215" height="318" rx="4" fill="none" stroke="#38bdf8" strokeOpacity="0.4" strokeWidth="1" />
            <rect x="17" y="15" width="207" height="310" rx="2" fill="none" stroke="#c084fc" strokeOpacity="0.22" strokeWidth="0.6" />
          </svg>
        );
      case 'jade-bamboo':
        return (
          <svg viewBox="0 0 240 340" className="w-full h-full object-cover" aria-hidden="true">
            <defs>
              <linearGradient id="bg-jade" x1="0" y1="0" x2="0.6" y2="1">
                <stop offset="0%" stopColor="#064e3b" />
                <stop offset="52%" stopColor="#047857" />
                <stop offset="100%" stopColor="#022c22" />
              </linearGradient>
            </defs>
            <rect width="240" height="340" fill="url(#bg-jade)" />
            <circle cx="170" cy="78" r="38" fill="#a7f3d0" fillOpacity="0.28" />
            <circle cx="170" cy="78" r="21" fill="#ecfdf5" fillOpacity="0.86" />
            <g stroke="#6ee7b7" strokeOpacity="0.5" strokeWidth="2.4">
              <line x1="60" y1="15" x2="60" y2="325" />
              <line x1="80" y1="35" x2="80" y2="325" />
            </g>
            <path d="M60 105 Q94 86 114 110 Q84 118 60 105 Z" fill="#6ee7b7" fillOpacity="0.5" />
            <path d="M80 158 Q117 138 134 162 Q102 170 80 158 Z" fill="#6ee7b7" fillOpacity="0.42" />
            <rect x="13" y="11" width="215" height="318" rx="4" fill="none" stroke="#6ee7b7" strokeOpacity="0.42" strokeWidth="1" />
            <rect x="17" y="15" width="207" height="310" rx="2" fill="none" stroke="#a7f3d0" strokeOpacity="0.2" strokeWidth="0.6" />
          </svg>
        );
      case 'crimson-blade':
        return (
          <svg viewBox="0 0 240 340" className="w-full h-full object-cover" aria-hidden="true">
            <defs>
              <linearGradient id="bg-crimson" x1="0" y1="0" x2="0.7" y2="1">
                <stop offset="0%" stopColor="#450a0a" />
                <stop offset="50%" stopColor="#7f1d1d" />
                <stop offset="100%" stopColor="#090d16" />
              </linearGradient>
            </defs>
            <rect width="240" height="340" fill="url(#bg-crimson)" />
            <circle cx="124" cy="108" r="50" fill="#f43f5e" fillOpacity="0.32" />
            <circle cx="124" cy="108" r="27" fill="#fecdd3" fillOpacity="0.88" />
            <path d="M50 240 L194 56" stroke="#fda4af" strokeOpacity="0.82" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M0 268 L104 184 L186 254 L240 204 L240 340 L0 340 Z" fill="#0c0a09" />
            <rect x="13" y="11" width="215" height="318" rx="4" fill="none" stroke="#fb7185" strokeOpacity="0.45" strokeWidth="1" />
            <rect x="17" y="15" width="207" height="310" rx="2" fill="none" stroke="#fecdd3" strokeOpacity="0.2" strokeWidth="0.6" />
          </svg>
        );
      case 'ancient-library':
      default:
        return (
          <svg viewBox="0 0 240 340" className="w-full h-full object-cover" aria-hidden="true">
            <defs>
              <linearGradient id="bg-lib" x1="0" y1="0" x2="0.3" y2="1">
                <stop offset="0%" stopColor="#1e1b4b" />
                <stop offset="55%" stopColor="#1c1917" />
                <stop offset="100%" stopColor="#0c0a09" />
              </linearGradient>
            </defs>
            <rect width="240" height="340" fill="url(#bg-lib)" />
            <circle cx="124" cy="106" r="40" fill="none" stroke="#fbbf24" strokeOpacity="0.6" strokeWidth="1.4" />
            <circle cx="124" cy="106" r="25" fill="none" stroke="#f59e0b" strokeOpacity="0.4" strokeWidth="0.9" strokeDasharray="4 3" />
            <path d="M94 106 L154 106 M124 76 L124 136" stroke="#fcd34d" strokeOpacity="0.5" strokeWidth="1" />
            <rect x="13" y="11" width="215" height="318" rx="4" fill="none" stroke="#fbbf24" strokeOpacity="0.42" strokeWidth="1" />
            <rect x="17" y="15" width="207" height="310" rx="2" fill="none" stroke="#fde68a" strokeOpacity="0.2" strokeWidth="0.6" />
          </svg>
        );
    }
  };

  return (
    <div
      className={`relative overflow-hidden select-none bg-stone-950 shadow-[4px_8px_22px_-4px_rgba(0,0,0,0.55)] ring-1 ring-amber-200/20 dark:ring-amber-300/20 group-hover:shadow-[6px_12px_28px_-4px_rgba(0,0,0,0.7)] transition-all duration-300 ${className}`}
    >
      {renderIllustration()}

      {/* Authentic Oriental Thread-Bound 3D Book Spine & Ridges on Left Edge */}
      <div className="absolute inset-y-0 left-0 w-3.5 bg-gradient-to-r from-black/80 via-amber-100/15 to-transparent pointer-events-none" />
      <div className="absolute inset-y-0 left-3 w-[1px] bg-amber-200/25 pointer-events-none" />
      {!compact && (
        <div className="absolute inset-y-4 left-0 w-3 flex flex-col justify-between py-2 pointer-events-none opacity-55">
          <div className="w-full h-[1px] bg-amber-200/60" />
          <div className="w-full h-[1px] bg-amber-200/60" />
          <div className="w-full h-[1px] bg-amber-200/60" />
          <div className="w-full h-[1px] bg-amber-200/60" />
        </div>
      )}

      {/* Right Page-Edge 3D Highlight */}
      <div className="absolute inset-y-0 right-0 w-1.5 bg-gradient-to-l from-amber-100/25 via-white/10 to-transparent pointer-events-none" />

      {/* Top Genre Stamp Badge if provided and no upload button overlapping */}
      {genre && !onUploadCoverImage && !onOpenCoverEditor && (
        <div className="absolute top-2.5 left-4 z-10 pointer-events-none">
          <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-xs border border-amber-300/35 text-[9px] font-semibold tracking-wider uppercase text-amber-200">
            {genre}
          </span>
        </div>
      )}

      {/* Action Buttons on Book Cover: Pick from Photo Library & Open Cover Editor */}
      {(onUploadCoverImage || onOpenCoverEditor) && (
        <div className="absolute top-2 left-3.5 right-2 z-20 flex items-center justify-between gap-1">
          {onUploadCoverImage && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                onClick={(e) => e.stopPropagation()}
                className="hidden"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="min-h-[26px] px-2 py-1 rounded-lg bg-black/75 hover:bg-amber-700/95 text-white backdrop-blur-xs border border-amber-300/35 flex items-center gap-1 text-[10px] font-semibold shadow-md transition-all cursor-pointer"
                title="Lấy ảnh từ thư viện làm giao diện sách"
              >
                <ImagePlus className="w-3 h-3 text-amber-300 shrink-0" />
                <span className="truncate">{compact ? 'Đổi bìa' : 'Ảnh thư viện'}</span>
              </button>
            </>
          )}

          {onOpenCoverEditor && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenCoverEditor();
              }}
              className="min-h-[26px] px-1.5 py-1 rounded-lg bg-black/75 hover:bg-purple-600/95 text-amber-200 hover:text-white backdrop-blur-xs border border-white/20 flex items-center justify-center shadow-md transition-all cursor-pointer shrink-0"
              title="Chỉnh bìa giao diện sách"
            >
              <Palette className="w-3 h-3 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* Bottom Title & Author Calligraphic Plaque */}
      {!compact && (
        <div className="absolute inset-x-0 bottom-0 pt-11 pb-2.5 px-3.5 bg-gradient-to-t from-black/95 via-black/75 to-transparent flex flex-col justify-end pointer-events-none">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-6 h-[1.5px] bg-amber-400/85 rounded-full" />
            <div className="w-1.5 h-1.5 rotate-45 bg-amber-300/80" />
          </div>
          <p className="font-display text-white font-bold text-xs sm:text-sm leading-snug line-clamp-2 tracking-wide drop-shadow-xs">
            {title}
          </p>
          <p className="text-[10px] text-amber-200/85 mt-0.5 truncate tracking-wider uppercase font-medium">
            {author}
          </p>
        </div>
      )}
    </div>
  );
};

interface BookCoverEditorModalProps {
  novel: Novel | null;
  onClose: () => void;
  onSaveCover: (
    novelId: string,
    updates: { coverStyle: Novel['coverStyle']; coverImageUrl?: string }
  ) => void;
}

export const BookCoverEditorModal: React.FC<BookCoverEditorModalProps> = ({
  novel,
  onClose,
  onSaveCover
}) => {
  const [selectedStyle, setSelectedStyle] = useState<Novel['coverStyle']>(
    novel?.coverStyle || 'ink-mountain'
  );
  const [customImageUrl, setCustomImageUrl] = useState<string>(novel?.coverImageUrl || '');
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (novel) {
      setSelectedStyle(novel.coverStyle || 'ink-mountain');
      setCustomImageUrl(novel.coverImageUrl || '');
    }
  }, [novel]);

  if (!novel) return null;

  const handleGalleryFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressBookCoverFile(file);
      setCustomImageUrl(dataUrl);
      onSaveCover(novel.id, {
        coverStyle: selectedStyle,
        coverImageUrl: dataUrl
      });
    } catch {
      // ignore invalid image
    } finally {
      e.target.value = '';
    }
  };

  const handleApplyPresetStyle = (styleId: Novel['coverStyle']) => {
    setSelectedStyle(styleId);
    setCustomImageUrl('');
    onSaveCover(novel.id, {
      coverStyle: styleId,
      coverImageUrl: ''
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4 select-none">
      <div className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#181824] text-stone-100 border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0">
              <Palette className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                Chỉnh Bìa Giao Diện Sách
              </h2>
              <p className="text-[11px] text-stone-400 truncate">{novel.title}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-5">
          {/* Live 3D Book Cover Preview + Photo Library Upload Card */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col sm:flex-row items-center gap-5">
            <div className="w-32 sm:w-36 shrink-0">
              <BookCoverArtwork
                styleType={selectedStyle}
                coverImageUrl={customImageUrl}
                title={novel.title}
                author={novel.author}
                genre={novel.genre}
                className="w-full aspect-[3/4] rounded-xl"
              />
            </div>

            <div className="flex-1 w-full space-y-3 text-center sm:text-left">
              <div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/30 text-[10px] font-semibold text-amber-300">
                  <Sparkles className="w-3 h-3" />
                  {customImageUrl ? 'Đang dùng ảnh từ thư viện' : 'Đang dùng bìa cổ phong'}
                </span>
                <h3 className="text-sm font-bold text-white mt-1.5 line-clamp-1">{novel.title}</h3>
                <p className="text-xs text-stone-400 mt-0.5">
                  Tải ảnh từ thư viện thiết bị để làm bìa sách 3D hoặc chọn một trong 6 mẫu bìa cổ phong bên dưới.
                </p>
              </div>

              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                onChange={handleGalleryFileChange}
                className="hidden"
              />

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-500 hover:opacity-95 text-stone-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4 shrink-0" />
                  <span>Lấy ảnh từ thư viện làm giao diện sách</span>
                </button>

                {customImageUrl && (
                  <button
                    type="button"
                    onClick={() => handleApplyPresetStyle(selectedStyle)}
                    className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-medium text-stone-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Khôi phục bìa vẽ cổ phong</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 6 Illustrated Oriental Cover Styles */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold text-stone-300">
              Hoặc chọn mẫu bìa giao diện sách vẽ sẵn (6 phong cách)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {COVER_STYLE_OPTIONS.map((item) => {
                const isSelected = !customImageUrl && selectedStyle === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleApplyPresetStyle(item.id)}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all cursor-pointer min-w-0 ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-400 text-white shadow-md'
                        : 'bg-white/5 border-white/10 text-stone-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="w-9 aspect-[3/4] rounded-md overflow-hidden shrink-0">
                      <BookCoverArtwork
                        styleType={item.id}
                        title={novel.title}
                        author={novel.author}
                        compact
                        className="w-full h-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold truncate">{item.label}</p>
                        {isSelected && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                      </div>
                      <p className="text-[10px] text-stone-400 truncate mt-0.5">{item.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Hoàn tất
          </button>
        </div>
      </div>
    </div>
  );
};
