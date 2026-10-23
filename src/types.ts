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

export type FemaleVoiceId = 'quynh-anh-4-0' | 'ngoc-huyen-ha-noi' | 'hoai-my-neural';

export interface FemaleVoiceOption {
  id: FemaleVoiceId;
  name: string;
  shortName: string;
  badge: string;
  description: string;
  baseRate: number;
  pitch: number;
  detuneCents: number;
  geminiVoice: 'Kore' | 'Zephyr' | 'Aoede';
  stylePrompt: string;
}

export const FEMALE_VOICE_OPTIONS: FemaleVoiceOption[] = [
  {
    id: 'quynh-anh-4-0',
    name: 'Quỳnh Anh 4.0 (VI - Nữ)',
    shortName: 'Quỳnh Anh 4.0',
    badge: 'Trong Trẻo · Nhịp 4.0',
    description:
      'Quỳnh Anh 4.0: Giọng nữ trẻ trung, âm sắc sáng trong trẻo (+18Hz), nhịp đọc linh hoạt 1.08x, ngắt nghỉ tự nhiên không vấp chữ.',
    baseRate: 1.08,
    pitch: 1.12,
    detuneCents: 130,
    geminiVoice: 'Kore',
    stylePrompt: 'Bright, youthful, crisp Northern Vietnamese female neural narrator Quynh Anh 4.0'
  },
  {
    id: 'ngoc-huyen-ha-noi',
    name: 'Ngọc Huyền Hà Nội (VI - Nữ)',
    shortName: 'Ngọc Huyền Hà Nội',
    badge: 'Hà Nội · Trầm Ấm',
    description:
      'Ngọc Huyền Hà Nội: Giọng nữ phát thanh viên Hà Nội trầm ấm (-18Hz), nhịp kể chuyện sâu lắng 0.96x, truyền cảm và dịu tai.',
    baseRate: 0.96,
    pitch: 0.88,
    detuneCents: -150,
    geminiVoice: 'Aoede',
    stylePrompt: 'Warm, deep, expressive Hanoi late-night radio female storyteller Ngoc Huyen'
  },
  {
    id: 'hoai-my-neural',
    name: 'Hoài My Neural (vi-VN-HoaiMyNeural)',
    shortName: 'Hoài My Neural',
    badge: 'HoaiMyNeural · Chuẩn Gốc',
    description:
      'Hoài My Neural: Giọng chuẩn vi-VN-HoaiMyNeural nguyên bản (0Hz, 1.0x), tìm và gán trực tiếp từ window.speechSynthesis hoặc luồng Neural gốc.',
    baseRate: 1.0,
    pitch: 1.0,
    detuneCents: 0,
    geminiVoice: 'Zephyr',
    stylePrompt: 'Clear, balanced standard Microsoft HoaiMyNeural Vietnamese female voice'
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
