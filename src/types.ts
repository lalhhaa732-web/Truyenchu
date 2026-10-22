export interface Chapter {
  id: string;
  novelId: string;
  number: number;
  title: string;
  content: string[];
  wordCount: number;
  publishedAt: string;
  sourceChapterUrl?: string;
}

export interface Novel {
  id: string;
  title: string;
  author: string;
  genre: string;
  status: 'Đang ra' | 'Hoàn thành';
  synopsis: string;
  coverStyle: 'ink-mountain' | 'imperial-moon' | 'star-nebula' | 'ancient-library' | 'jade-bamboo' | 'crimson-blade';
  coverImageUrl?: string;
  views: number;
  rating: number;
  updatedAt: string;
  chapters: Chapter[];
  sourceUrl?: string;
  autoFetchEnabled?: boolean;
  lastSyncedAt?: string;
  pendingChapterLinks?: { title: string; url: string }[];
}

export interface RealtimeUpdateEvent {
  id: string;
  type: 'chapter:published' | 'novel:created' | 'novel:updated' | 'presence:update' | 'init:state';
  novelId?: string;
  novelTitle?: string;
  chapter?: Chapter;
  novel?: Novel;
  novels?: Novel[];
  activeReaders?: number;
  timestamp: string;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type ReaderFont = 'serif' | 'sans';

export type FemaleVoiceId =
  | 'quynh-anh-4-0'
  | 'nu-review-phim'
  | 'nu-kich-tinh'
  | 'nu-tien-hiep'
  | 'nu-ngot-ngao'
  | 'nu-ha-noi'
  | 'nu-sai-gon';

export interface FemaleVoiceOption {
  id: FemaleVoiceId;
  name: string;
  shortName: string;
  badge: string;
  description: string;
  baseRate: number;
  pitch: number;
  detuneCents: number;
  geminiVoice: 'Kore' | 'Zephyr';
  stylePrompt: string;
}

export const FEMALE_VOICE_OPTIONS: FemaleVoiceOption[] = [
  {
    id: 'quynh-anh-4-0',
    name: 'Quỳnh Anh 4.0 (VI - Nữ)',
    shortName: 'Quỳnh Anh 4.0',
    badge: 'VI - Nữ · MP3',
    description:
      'Quỳnh Anh 4.0: Truyện tranh, audio, review phim, phim Trung... Chất giọng nữ AI tự nhiên, trong trẻo, đọc trôi chảy không vấp.',
    baseRate: 1.0,
    pitch: 1.0,
    detuneCents: 0,
    geminiVoice: 'Kore',
    stylePrompt: 'Natural, sweet, articulate Northern Vietnamese female neural narrator Quynh Anh 4.0'
  },
  {
    id: 'nu-review-phim',
    name: 'Quỳnh Anh Review Phim (1.25x)',
    shortName: 'Quỳnh Anh 1.25x',
    badge: 'Review Phim · 1.25x',
    description:
      'Chất giọng Quỳnh Anh 4.0 nhịp nhanh 1.25x chuyên review phim, truyện tranh, phim Trung chuẩn YouTube giữ nguyên tông giọng.',
    baseRate: 1.25,
    pitch: 1.0,
    detuneCents: 0,
    geminiVoice: 'Kore',
    stylePrompt: 'Fast-paced, crisp, engaging Vietnamese female movie review narrator'
  },
  {
    id: 'nu-kich-tinh',
    name: 'Quỳnh Anh Nhịp Nhanh (1.5x)',
    shortName: 'Nữ Nhịp Nhanh',
    badge: 'Tốc độ 1.5x',
    description:
      'Giọng nữ đọc nhanh 1.5x chuẩn YouTube cho đoạn cao trào, dứt khoát mà không làm biến đổi giọng.',
    baseRate: 1.5,
    pitch: 1.0,
    detuneCents: 0,
    geminiVoice: 'Kore',
    stylePrompt: 'Dramatic, intense, fast-paced Vietnamese female action movie reviewer'
  },
  {
    id: 'nu-tien-hiep',
    name: 'Nữ Audio Tiên Hiệp (1.1x)',
    shortName: 'Nữ Tiên Hiệp',
    badge: 'Audio · 1.1x',
    description:
      'Giọng nữ kể chuyện nhịp 1.1x mượt mà, truyền cảm khi nghe tiểu thuyết tiên hiệp, cổ phong dài kỳ.',
    baseRate: 1.1,
    pitch: 1.0,
    detuneCents: 0,
    geminiVoice: 'Zephyr',
    stylePrompt: 'Ethereal, clear, graceful Vietnamese female fantasy storyteller'
  },
  {
    id: 'nu-ha-noi',
    name: 'Nữ Hà Nội Truyền Cảm (1.0x)',
    shortName: 'Nữ Hà Nội',
    badge: 'Chuẩn 1.0x',
    description:
      'Giọng nữ Bắc ấm áp tốc độ chuẩn 1.0x, phát âm tròn vành rõ chữ, nhịp điệu điềm tĩnh.',
    baseRate: 1.0,
    pitch: 1.0,
    detuneCents: 0,
    geminiVoice: 'Kore',
    stylePrompt: 'Polished, articulate Northern Vietnamese female audiobook narrator'
  },
  {
    id: 'nu-ngot-ngao',
    name: 'Nữ Nghe Đêm Dịu Êm (0.9x)',
    shortName: 'Nữ Nghe Đêm',
    badge: 'Tốc độ 0.9x',
    description:
      'Giọng nữ nhẹ nhàng, nhịp đọc 0.9x thư giãn trước khi ngủ, giữ nguyên độ trong trẻo tự nhiên.',
    baseRate: 0.9,
    pitch: 1.0,
    detuneCents: 0,
    geminiVoice: 'Zephyr',
    stylePrompt: 'Warm, soothing, gentle late-night Vietnamese female radio host'
  }
];

export function getFemaleVoiceOption(voiceId?: string): FemaleVoiceOption {
  return FEMALE_VOICE_OPTIONS.find((v) => v.id === voiceId) || FEMALE_VOICE_OPTIONS[0];
}

export interface ReaderSettings {
  theme: ReaderTheme;
  fontFamily: ReaderFont;
  fontSize: number; // 15 to 26
  lineHeight: number; // 1.6 to 2.2
  autoScrollSpeed: number; // 1 to 10
  autoNextChapter: boolean;
  ttsRate: number; // 0.8 to 1.6
  ttsVoiceId: FemaleVoiceId;
}

export interface ReadingProgress {
  novelId: string;
  chapterId: string;
  chapterNumber: number;
  scrollPercentage: number;
  updatedAt: string;
}
