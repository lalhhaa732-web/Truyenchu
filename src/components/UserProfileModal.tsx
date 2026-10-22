import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  UserCircle,
  User as UserIcon,
  Settings,
  Star,
  Check,
  Cloud,
  LogIn,
  ShieldCheck,
  BookOpen,
  Bookmark,
  ImagePlus,
  Sparkles,
  Crown,
  Trash2,
  PlusCircle,
  Radio,
  Link2,
  GitBranch
} from 'lucide-react';
import { User } from 'firebase/auth';
import { Novel, ReaderSettings, FEMALE_VOICE_OPTIONS } from '../types';
import { PublishModalMode } from './PublishChapterModal';

export type ProfileSectionType = 'account' | 'profile' | 'settings' | 'title' | 'admin' | null;

export interface UserProfileData {
  nickname: string;
  avatarUrl: string;
  bio: string;
  level: number;
  exp: number;
  equippedTitle: string;
  unlockedTitles: string[];
}

export interface TitleDefinition {
  id: string;
  name: string;
  tier: number;
  minLevel: number;
  maxLevel: number;
  rarity: string;
  colorName: string;
  description: string;
  // Classes for the circular avatar border/ring
  ringClass: string;
  glowClass: string;
  // Classes for the title text and badge
  textClass: string;
  badgeClass: string;
  buttonClass: string;
  swatchClass: string;
}

export const AVAILABLE_TITLES: TitleDefinition[] = [
  {
    id: 'Tân Thủ Thư Sinh',
    name: 'Tân Thủ Thư Sinh',
    tier: 1,
    minLevel: 1,
    maxLevel: 10,
    rarity: 'Phàm Phẩm',
    colorName: 'Bạch Ngân',
    description: 'Độc giả mới bước chân vào Mạc Thư Các, bắt đầu hành trình đọc sách.',
    ringClass: 'bg-stone-400',
    glowClass: 'shadow-[0_0_8px_rgba(168,162,158,0.45)]',
    textClass: 'text-stone-300',
    badgeClass: 'bg-stone-500/15 border-stone-400/40 text-stone-200',
    buttonClass: 'bg-stone-600 hover:bg-stone-500 text-white',
    swatchClass: 'bg-stone-400'
  },
  {
    id: 'Ưng Nhãn Độc Giả',
    name: 'Ưng Nhãn Độc Giả',
    tier: 2,
    minLevel: 11,
    maxLevel: 20,
    rarity: 'Linh Phẩm',
    colorName: 'Lục Bảo',
    description: 'Đôi mắt tinh anh luôn bắt kịp chương mới ngay khi vừa lên sóng.',
    ringClass: 'bg-emerald-500',
    glowClass: 'shadow-[0_0_10px_rgba(16,185,129,0.55)]',
    textClass: 'text-emerald-400',
    badgeClass: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    swatchClass: 'bg-emerald-500'
  },
  {
    id: 'Kiếm Khách Sơ Nhập',
    name: 'Kiếm Khách Sơ Nhập',
    tier: 3,
    minLevel: 21,
    maxLevel: 30,
    rarity: 'Huyền Phẩm',
    colorName: 'Thanh Lam',
    description: 'Kiếm khí thanh tao, rong ruổi qua các bộ truyện Tiên Hiệp kỳ ảo.',
    ringClass: 'bg-cyan-400',
    glowClass: 'shadow-[0_0_12px_rgba(34,211,238,0.6)]',
    textClass: 'text-cyan-400',
    badgeClass: 'bg-cyan-500/15 border-cyan-400/45 text-cyan-300',
    buttonClass: 'bg-cyan-600 hover:bg-cyan-500 text-white',
    swatchClass: 'bg-cyan-400'
  },
  {
    id: 'Thư Viện Thủ Hộ',
    name: 'Thư Viện Thủ Hộ',
    tier: 4,
    minLevel: 31,
    maxLevel: 40,
    rarity: 'Địa Phẩm',
    colorName: 'Lam Bảo Thạch',
    description: 'Người lưu giữ và đồng bộ các pho thư tịch cổ trong tàng thư các.',
    ringClass: 'bg-blue-500',
    glowClass: 'shadow-[0_0_12px_rgba(59,130,246,0.65)]',
    textClass: 'text-blue-400',
    badgeClass: 'bg-blue-500/15 border-blue-500/45 text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-500 text-white',
    swatchClass: 'bg-blue-500'
  },
  {
    id: 'Độc Giả Vạn Quyển',
    name: 'Độc Giả Vạn Quyển',
    tier: 5,
    minLevel: 41,
    maxLevel: 50,
    rarity: 'Thiên Phẩm',
    colorName: 'Tử Tinh',
    description: 'Đọc thông vạn quyển sách, tinh thông mọi thể loại cổ kim.',
    ringClass: 'bg-purple-500',
    glowClass: 'shadow-[0_0_14px_rgba(168,85,247,0.7)]',
    textClass: 'text-purple-400',
    badgeClass: 'bg-purple-500/15 border-purple-500/50 text-purple-300',
    buttonClass: 'bg-purple-600 hover:bg-purple-500 text-white',
    swatchClass: 'bg-purple-500'
  },
  {
    id: 'Tinh Hà Hành Giả',
    name: 'Tinh Hà Hành Giả',
    tier: 6,
    minLevel: 51,
    maxLevel: 60,
    rarity: 'Tiên Phẩm',
    colorName: 'Hồng Liên',
    description: 'Lữ khách du hành qua hàng ngàn chương truyện giữa dải ngân hà.',
    ringClass: 'bg-gradient-to-tr from-fuchsia-500 to-pink-500',
    glowClass: 'shadow-[0_0_15px_rgba(236,72,153,0.75)]',
    textClass: 'text-pink-400',
    badgeClass: 'bg-pink-500/15 border-pink-500/50 text-pink-300',
    buttonClass: 'bg-pink-600 hover:bg-pink-500 text-white',
    swatchClass: 'bg-gradient-to-tr from-fuchsia-500 to-pink-500'
  },
  {
    id: 'Kiếm Đạo Tông Sư',
    name: 'Kiếm Đạo Tông Sư',
    tier: 7,
    minLevel: 61,
    maxLevel: 70,
    rarity: 'Thánh Phẩm',
    colorName: 'Cam Hổ Phách',
    description: 'Bậc tông sư lĩnh ngộ kiếm ý thượng thừa qua từng trang thư tịch.',
    ringClass: 'bg-gradient-to-tr from-amber-500 to-orange-500',
    glowClass: 'shadow-[0_0_16px_rgba(249,115,22,0.8)]',
    textClass: 'text-orange-400',
    badgeClass: 'bg-orange-500/15 border-orange-500/50 text-orange-300',
    buttonClass: 'bg-orange-600 hover:bg-orange-500 text-white',
    swatchClass: 'bg-gradient-to-tr from-amber-500 to-orange-500'
  },
  {
    id: 'Cổ Kim Kỳ Tài',
    name: 'Cổ Kim Kỳ Tài',
    tier: 8,
    minLevel: 71,
    maxLevel: 80,
    rarity: 'Thần Phẩm',
    colorName: 'Đỏ Huyết Ngọc',
    description: 'Kỳ tài ngàn năm có một, thấu hiểu thiên cơ trong từng chữ nghĩa.',
    ringClass: 'bg-gradient-to-tr from-rose-600 via-red-500 to-rose-400',
    glowClass: 'shadow-[0_0_18px_rgba(244,63,94,0.85)]',
    textClass: 'text-rose-400',
    badgeClass: 'bg-rose-500/20 border-rose-500/55 text-rose-300',
    buttonClass: 'bg-rose-600 hover:bg-rose-500 text-white',
    swatchClass: 'bg-gradient-to-tr from-rose-600 via-red-500 to-rose-400'
  },
  {
    id: 'Thiên Cơ Tiên Tôn',
    name: 'Thiên Cơ Tiên Tôn',
    tier: 9,
    minLevel: 81,
    maxLevel: 90,
    rarity: 'Chí Tôn',
    colorName: 'Hoàng Kim Đế Vương',
    description: 'Bậc Tiên Tôn ngự trên cửu trùng thiên, hào quang hoàng kim rực rỡ.',
    ringClass: 'bg-gradient-to-tr from-yellow-500 via-amber-300 to-yellow-400',
    glowClass: 'shadow-[0_0_20px_rgba(250,204,21,0.9)]',
    textClass: 'text-yellow-300',
    badgeClass: 'bg-yellow-500/20 border-yellow-400/60 text-yellow-200',
    buttonClass: 'bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold',
    swatchClass: 'bg-gradient-to-tr from-yellow-500 via-amber-300 to-yellow-400'
  },
  {
    id: 'Vạn Cổ Thư Đế',
    name: 'Vạn Cổ Thư Đế',
    tier: 10,
    minLevel: 91,
    maxLevel: 100,
    rarity: 'Thần Thoại',
    colorName: 'Thất Sắc Cực Quang',
    description: 'Đỉnh phong cấp 100! Thư Đế thống lĩnh vạn cổ với thần quang thất sắc.',
    ringClass: 'bg-gradient-to-tr from-rose-500 via-purple-500 to-cyan-400',
    glowClass: 'shadow-[0_0_22px_rgba(168,85,247,0.95)]',
    textClass: 'bg-gradient-to-r from-rose-400 via-amber-300 to-cyan-300 bg-clip-text text-transparent font-extrabold',
    badgeClass: 'bg-gradient-to-r from-rose-500/25 via-purple-500/25 to-cyan-500/25 border-amber-300/60 text-amber-200',
    buttonClass: 'bg-gradient-to-r from-rose-500 via-purple-600 to-cyan-500 hover:opacity-95 text-white font-bold',
    swatchClass: 'bg-gradient-to-tr from-rose-500 via-amber-400 to-cyan-400'
  }
];

export function getTitleForLevel(level: number): TitleDefinition {
  const clamped = Math.max(1, Math.min(100, Math.floor(level || 1)));
  const found = AVAILABLE_TITLES.find((t) => clamped >= t.minLevel && clamped <= t.maxLevel);
  return found || AVAILABLE_TITLES[0];
}

export function getTitleTheme(equippedTitle?: string, fallbackLevel = 1): TitleDefinition {
  if (equippedTitle) {
    const exact = AVAILABLE_TITLES.find((t) => t.name === equippedTitle || t.id === equippedTitle);
    if (exact) return exact;
    if (equippedTitle === 'Ưng Nhãn') return AVAILABLE_TITLES[1];
  }
  return getTitleForLevel(fallbackLevel);
}

export function hasLiquidGlassEffect(level: number): boolean {
  return Math.floor(Number(level) || 1) >= 50;
}

export function getRequiredExpForLevel(level: number): number {
  const lvl = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  if (lvl < 20) {
    // Lv 1: 500 EXP -> Lv 19: 5.000 EXP (+250 EXP mỗi cấp)
    return 500 + (lvl - 1) * 250;
  }
  if (lvl <= 50) {
    // Lv 20: 6.000 EXP -> Lv 50: 24.000 EXP (+600 EXP mỗi cấp)
    return 6000 + (lvl - 20) * 600;
  }
  // Lv 51: 26.000 EXP -> Lv 99: 93.200 EXP, Lv 100: 95.000 EXP (+1.400 EXP mỗi cấp)
  return Math.min(95000, 26000 + (lvl - 51) * 1400);
}

export interface ReadingExpRule {
  requiredMinutes: number;
  requiredSeconds: number;
  expGain: number;
  tierLabel: string;
}

export function getReadingExpRule(level: number): ReadingExpRule {
  const lvl = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  if (lvl < 20) {
    return {
      requiredMinutes: 5,
      requiredSeconds: 300,
      expGain: 100,
      tierLabel: 'Dưới cấp 20: Đọc 5 phút +100 EXP'
    };
  }
  if (lvl <= 50) {
    return {
      requiredMinutes: 10,
      requiredSeconds: 600,
      expGain: 150,
      tierLabel: 'Cấp 20 – 50: Đọc 10 phút +150 EXP'
    };
  }
  return {
    requiredMinutes: 15,
    requiredSeconds: 900,
    expGain: 200,
    tierLabel: 'Cấp 51 trở lên: Đọc 15 phút +200 EXP'
  };
}

export const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=240&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=240&auto=format&fit=crop&q=80'
];

interface UserProfileModalProps {
  activeSection: ProfileSectionType;
  onClose: () => void;
  onSwitchSection: (section: ProfileSectionType) => void;
  profile: UserProfileData;
  onUpdateProfile: (partial: Partial<UserProfileData>) => void;
  settings: ReaderSettings;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  currentUser: User | null;
  isAdmin: boolean;
  onSignInGoogle: () => void;
  bookmarkedCount: number;
  readNovelsCount: number;
  novels: Novel[];
  onOpenPublishModal: (mode: PublishModalMode) => void;
  onTriggerLiveBroadcast: () => void;
  onDeleteNovel: (novelId: string) => void;
  readingSecondsInCycle?: number;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  activeSection,
  onClose,
  onSwitchSection,
  profile,
  onUpdateProfile,
  settings,
  onUpdateSettings,
  currentUser,
  isAdmin,
  onSignInGoogle,
  bookmarkedCount,
  readNovelsCount,
  novels,
  onOpenPublishModal,
  onTriggerLiveBroadcast,
  onDeleteNovel,
  readingSecondsInCycle = 0
}) => {
  const [nicknameInput, setNicknameInput] = useState(profile.nickname);
  const [bioInput, setBioInput] = useState(profile.bio);
  const [avatarInput, setAvatarInput] = useState(profile.avatarUrl);
  const [savedNotice, setSavedNotice] = useState(false);
  const [avatarClickBurst, setAvatarClickBurst] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setNicknameInput(profile.nickname);
    setBioInput(profile.bio);
    setAvatarInput(profile.avatarUrl);
  }, [profile.nickname, profile.bio, profile.avatarUrl, activeSection]);

  if (!activeSection) return null;

  const activeTitleTheme = getTitleTheme(profile.equippedTitle, profile.level);
  const hasLiquidGlass = hasLiquidGlassEffect(profile.level);
  const requiredExp = getRequiredExpForLevel(profile.level);
  const currentExpRule = getReadingExpRule(profile.level);
  const expProgressPercent =
    profile.level >= 100
      ? 100
      : Math.max(2, Math.min(100, Math.round(((profile.exp || 0) / requiredExp) * 100)));

  const handleSelectGalleryImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 180;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
          setAvatarInput(compressedDataUrl);
          onUpdateProfile({ avatarUrl: compressedDataUrl });
          setSavedNotice(true);
          setTimeout(() => setSavedNotice(false), 2000);
        }
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile({
      nickname: nicknameInput.trim() || 'Không còn não',
      bio: bioInput.trim(),
      avatarUrl: avatarInput || profile.avatarUrl
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleChangeLevel = (newLevel: number) => {
    if (!isAdmin) return;
    const clamped = Math.max(1, Math.min(100, newLevel));
    const matchedTitle = getTitleForLevel(clamped);
    onUpdateProfile({
      level: clamped,
      exp: 0,
      equippedTitle: matchedTitle.name
    });
  };

  const tabs = [
    { id: 'account', label: 'Tài khoản' },
    { id: 'profile', label: 'Hồ sơ' },
    { id: 'settings', label: 'Cài đặt' },
    { id: 'title', label: 'Danh hiệu' },
    ...(isAdmin ? [{ id: 'admin', label: '👑 Admin' }] : [])
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div
        className={`w-full max-w-lg rounded-2xl text-stone-100 overflow-hidden flex flex-col max-h-[90vh] ${
          hasLiquidGlass
            ? 'liquid-glass-popover'
            : 'bg-[#181824] border border-white/10 shadow-2xl'
        }`}
        style={{ transformOrigin: 'center center' }}
      >
        {/* Top Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-white/15 flex items-center justify-between gap-3 bg-white/[0.04] shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {activeSection === 'account' && <UserCircle className="w-5 h-5 text-purple-400 shrink-0" />}
            {activeSection === 'profile' && <UserIcon className="w-5 h-5 text-purple-400 shrink-0" />}
            {activeSection === 'settings' && <Settings className="w-5 h-5 text-purple-400 shrink-0" />}
            {activeSection === 'title' && <Star className="w-5 h-5 text-amber-400 shrink-0" />}
            {activeSection === 'admin' && <Crown className="w-5 h-5 text-amber-400 shrink-0" />}
            <h2 className="font-display text-base sm:text-lg font-bold text-white truncate">
              {activeSection === 'account' && 'Tài khoản của tôi'}
              {activeSection === 'profile' && 'Hồ sơ của tôi'}
              {activeSection === 'settings' && 'Cài đặt tài khoản'}
              {activeSection === 'title' && '10 Danh Hiệu Độc Giả (Lv 1 – 100)'}
              {activeSection === 'admin' && 'Trung Tâm Quản Trị Admin'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Tabs Switcher */}
        <div className="px-4 sm:px-6 py-2 bg-[#14141F] border-b border-white/10 flex flex-wrap items-center gap-1.5 text-xs shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSwitchSection(tab.id as ProfileSectionType)}
              className={`px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer ${
                activeSection === tab.id
                  ? tab.id === 'admin'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-stone-950 font-bold'
                    : 'bg-purple-600 text-white'
                  : 'text-stone-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto overflow-x-hidden space-y-5 flex-1">
          {/* 1. TÀI KHOẢN CỦA TÔI */}
          {activeSection === 'account' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3.5 p-3.5 sm:p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="relative flex items-center justify-center shrink-0">
                  {hasLiquidGlass && avatarClickBurst > 0 && (
                    <span
                      key={`modal-acc-ripple-${avatarClickBurst}`}
                      className="liquid-glass-ripple"
                      aria-hidden="true"
                    />
                  )}
                  <button
                    key={`modal-acc-orb-${avatarClickBurst}`}
                    type="button"
                    onClick={() => {
                      if (hasLiquidGlass) setAvatarClickBurst((k) => k + 1);
                      onSwitchSection('profile');
                    }}
                    className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full p-[3px] shrink-0 cursor-pointer transition-transform active:scale-95 ${
                      hasLiquidGlass
                        ? `liquid-glass-avatar ${
                            avatarClickBurst > 0 ? 'liquid-glass-avatar-active liquid-glass-avatar-burst' : ''
                          }`
                        : ''
                    } ${activeTitleTheme.ringClass} ${activeTitleTheme.glowClass}`}
                    title="Nhấn vào Avatar để đổi ảnh đại diện"
                  >
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-[#181824]">
                      <img
                        src={profile.avatarUrl}
                        alt={profile.nickname}
                        className="w-full h-full rounded-full object-cover"
                      />
                      {hasLiquidGlass && <span className="liquid-glass-lens" aria-hidden="true" />}
                    </div>
                  </button>
                </div>
                <div className="min-w-0 flex-1 overflow-hidden space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-bold text-white truncate max-w-full">
                      {profile.nickname}
                    </h3>
                    {isAdmin && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-500/25 to-yellow-500/25 border border-amber-400/60 text-[10px] font-extrabold text-amber-300 uppercase tracking-wider shrink-0">
                        <Crown className="w-3 h-3 text-amber-400 shrink-0" />
                        Admin
                      </span>
                    )}
                    {hasLiquidGlass ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/40 text-[10px] font-bold text-cyan-300 shrink-0">
                        <Sparkles className="w-2.5 h-2.5 text-cyan-300 shrink-0" />
                        Liquid Glass
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] font-medium text-stone-400 shrink-0">
                        Liquid Glass mở ở Lv 50
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-mono-num font-bold text-stone-200 shrink-0">
                      Lv {profile.level}/100
                    </span>
                    <span className="text-stone-500 shrink-0">·</span>
                    <span className={`font-semibold truncate ${activeTitleTheme.textClass}`}>
                      {activeTitleTheme.name}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-semibold shrink-0 ${activeTitleTheme.badgeClass}`}>
                      {activeTitleTheme.rarity}
                    </span>
                  </div>
                </div>
              </div>

              {/* Level & Reading EXP Progression */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-stone-300 font-medium">
                    Cấp độ: <strong className="text-white font-mono-num">Lv {profile.level} / 100</strong>
                  </span>
                  <span className="font-mono-num text-purple-400 font-semibold">
                    {profile.level >= 100
                      ? 'Đỉnh phong (MAX EXP)'
                      : `${(profile.exp || 0).toLocaleString('vi-VN')} / ${requiredExp.toLocaleString('vi-VN')} EXP`}
                  </span>
                </div>

                {/* EXP Progress Bar for Current Level */}
                <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${activeTitleTheme.ringClass}`}
                    style={{ width: `${expProgressPercent}%` }}
                  />
                </div>

                {/* Reading Time EXP Rules Breakdown */}
                <div className="p-3 rounded-xl bg-black/25 border border-white/10 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 shrink-0" />
                      Tu luyện bằng đọc truyện
                    </span>
                    <span className="font-mono-num text-[11px] text-stone-300">
                      Chu kỳ hiện tại: {Math.floor(readingSecondsInCycle / 60)}p {readingSecondsInCycle % 60}s / {currentExpRule.requiredMinutes}p
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-400 leading-relaxed">
                    Cấp càng cao cần càng nhiều EXP để đột phá (từ 500 EXP ở Lv 1 lên đến 95.000 EXP ở Lv 100):
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-0.5 text-[11px]">
                    <div
                      className={`px-2.5 py-1.5 rounded-lg border ${
                        profile.level < 20
                          ? 'bg-purple-500/20 border-purple-400/50 text-white font-semibold'
                          : 'bg-white/5 border-white/10 text-stone-400'
                      }`}
                    >
                      <div>Dưới Lv 20: <span className="font-mono-num text-emerald-400">5p +100 EXP</span></div>
                      <div className="text-[10px] text-stone-400 font-mono-num mt-0.5">Cần 500 – 5.000 EXP/cấp</div>
                    </div>
                    <div
                      className={`px-2.5 py-1.5 rounded-lg border ${
                        profile.level >= 20 && profile.level <= 50
                          ? 'bg-purple-500/20 border-purple-400/50 text-white font-semibold'
                          : 'bg-white/5 border-white/10 text-stone-400'
                      }`}
                    >
                      <div>Lv 20–50: <span className="font-mono-num text-emerald-400">10p +150 EXP</span></div>
                      <div className="text-[10px] text-stone-400 font-mono-num mt-0.5">Cần 6.000 – 24.000 EXP/cấp</div>
                    </div>
                    <div
                      className={`px-2.5 py-1.5 rounded-lg border ${
                        profile.level >= 51
                          ? 'bg-purple-500/20 border-purple-400/50 text-white font-semibold'
                          : 'bg-white/5 border-white/10 text-stone-400'
                      }`}
                    >
                      <div>Lv 51+: <span className="font-mono-num text-emerald-400">15p +200 EXP</span></div>
                      <div className="text-[10px] text-stone-400 font-mono-num mt-0.5">Cần 26.000 – 95.000 EXP/cấp</div>
                    </div>
                  </div>
                </div>

                {/* Admin-ONLY Level Slider */}
                {isAdmin && (
                  <div className="pt-2 border-t border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-amber-300 font-semibold">
                      <span className="flex items-center gap-1 truncate">
                        <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        Đặc quyền Admin: Điều chỉnh cấp độ
                      </span>
                      <span className="font-mono-num text-amber-200 shrink-0">Lv {profile.level}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={profile.level}
                      onChange={(e) => handleChangeLevel(Number(e.target.value))}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] font-mono-num text-stone-500">
                      <span>Lv 1</span>
                      <span>Lv 25</span>
                      <span>Lv 50 (Liquid Glass)</span>
                      <span>Lv 75</span>
                      <span>Lv 100</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2.5 min-w-0">
                  <Bookmark className="w-5 h-5 text-purple-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-white font-mono-num">{bookmarkedCount}</p>
                    <p className="text-xs text-stone-400 truncate">Truyện theo dõi</p>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2.5 min-w-0">
                  <BookOpen className="w-5 h-5 text-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-white font-mono-num">{readNovelsCount}</p>
                    <p className="text-xs text-stone-400 truncate">Truyện đang đọc</p>
                  </div>
                </div>
              </div>

              {/* Cloud Sync Info */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-white/5 border border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-stone-200">
                    <Cloud className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Liên kết đám mây Firebase</span>
                  </div>
                  {currentUser && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      {isAdmin ? 'Đã đồng bộ (Admin)' : 'Đã đồng bộ'}
                    </span>
                  )}
                </div>

                {currentUser ? (
                  <div className="text-xs text-stone-300 space-y-1 min-w-0">
                    <p className="truncate">
                      Email: <span className="text-white font-medium">{currentUser.email}</span>
                    </p>
                    <p className="text-stone-400 leading-relaxed">
                      {isAdmin
                        ? 'Tài khoản quản trị viên có toàn quyền quản lý kho truyện và hệ thống.'
                        : 'Tủ sách và tiến độ đọc của bạn được lưu tự động trên đám mây.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-xs text-stone-400">
                      Đăng nhập Google để đồng bộ tiến độ đọc, danh hiệu và tủ sách trên mọi thiết bị.
                    </p>
                    <button
                      type="button"
                      onClick={onSignInGoogle}
                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5 shrink-0" />
                      <span>Liên kết tài khoản Google</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. HỒ SƠ CỦA TÔI */}
          {activeSection === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="flex items-center gap-3.5">
                <div className="relative flex items-center justify-center shrink-0">
                  {hasLiquidGlass && avatarClickBurst > 0 && (
                    <span
                      key={`modal-prof-ripple-${avatarClickBurst}`}
                      className="liquid-glass-ripple"
                      aria-hidden="true"
                    />
                  )}
                  <button
                    key={`modal-prof-orb-${avatarClickBurst}`}
                    type="button"
                    onClick={() => {
                      if (hasLiquidGlass) setAvatarClickBurst((k) => k + 1);
                      fileInputRef.current?.click();
                    }}
                    className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full p-[3px] shrink-0 cursor-pointer transition-transform active:scale-95 ${
                      hasLiquidGlass
                        ? `liquid-glass-avatar ${
                            avatarClickBurst > 0 ? 'liquid-glass-avatar-active liquid-glass-avatar-burst' : ''
                          }`
                        : ''
                    } ${activeTitleTheme.ringClass} ${activeTitleTheme.glowClass}`}
                    title="Nhấn để tải ảnh đại diện mới"
                  >
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-[#181824]">
                      <img
                        src={avatarInput || profile.avatarUrl}
                        alt="Avatar preview"
                        className="w-full h-full rounded-full object-cover"
                      />
                      {hasLiquidGlass && <span className="liquid-glass-lens" aria-hidden="true" />}
                    </div>
                  </button>
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <p className="text-xs font-medium text-stone-300 truncate">
                    Ảnh đại diện{' '}
                    <span className="text-stone-400">
                      (Viền {activeTitleTheme.colorName}
                      {hasLiquidGlass ? ' · Liquid Glass' : ' · Liquid Glass mở từ Lv 50'})
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleSelectGalleryImage}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (hasLiquidGlass) setAvatarClickBurst((k) => k + 1);
                        fileInputRef.current?.click();
                      }}
                      className={`px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer ${
                        hasLiquidGlass ? 'liquid-glass-menu-item' : ''
                      }`}
                    >
                      <ImagePlus className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>Tải từ thư viện ảnh</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      {PRESET_AVATARS.map((url, idx) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => {
                            if (hasLiquidGlass) setAvatarClickBurst((k) => k + 1);
                            setAvatarInput(url);
                          }}
                          className={`relative w-8 h-8 rounded-full overflow-hidden border-2 transition-all cursor-pointer ${
                            hasLiquidGlass ? 'liquid-glass-avatar' : ''
                          } ${
                            avatarInput === url ? 'border-purple-400 scale-110' : 'border-white/30 opacity-80 hover:opacity-100'
                          }`}
                          title={`Ảnh mẫu ${idx + 1}`}
                        >
                          <img src={url} alt={`Mẫu ${idx + 1}`} className="w-full h-full object-cover rounded-full" />
                          {hasLiquidGlass && <span className="liquid-glass-lens" aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-stone-300">Biệt danh hiển thị</label>
                <input
                  type="text"
                  value={nicknameInput}
                  onChange={(e) => setNicknameInput(e.target.value)}
                  maxLength={40}
                  className="w-full h-10 px-3.5 rounded-xl bg-white/5 border border-white/15 text-sm text-white focus:outline-none focus:border-purple-500"
                  placeholder="Nhập biệt danh..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-stone-300">Giới thiệu bản thân</label>
                <textarea
                  rows={3}
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                  maxLength={200}
                  className="w-full p-3.5 rounded-xl bg-white/5 border border-white/15 text-xs text-white focus:outline-none focus:border-purple-500"
                  placeholder="Độc giả yêu thích Tiên Hiệp & Cổ Phong..."
                />
              </div>

              <div className="pt-2 flex items-center justify-between gap-2">
                {savedNotice ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-4 h-4 shrink-0" /> Đã lưu hồ sơ!
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          )}

          {/* 3. CÀI ĐẶT TÀI KHOẢN */}
          {activeSection === 'settings' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-stone-300">Giao diện mặc định</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'light', label: 'Giấy Sáng' },
                    { id: 'sepia', label: 'Cổ Điển' },
                    { id: 'dark', label: 'Đêm Tối' }
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onUpdateSettings({ theme: t.id as ReaderSettings['theme'] })}
                      className={`py-2.5 px-2 rounded-xl border text-xs font-medium transition-colors truncate cursor-pointer ${
                        settings.theme === t.id
                          ? 'bg-purple-600/25 border-purple-500 text-white'
                          : 'bg-white/5 border-white/10 text-stone-400 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-stone-300 font-medium">Cỡ chữ đọc truyện</span>
                  <span className="font-mono-num text-purple-400">{settings.fontSize}px</span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={26}
                  value={settings.fontSize}
                  onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-stone-300 font-medium">Tốc độ tự động cuộn mặc định</span>
                  <span className="font-mono-num text-purple-400">{settings.autoScrollSpeed}x</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={settings.autoScrollSpeed}
                  onChange={(e) => onUpdateSettings({ autoScrollSpeed: Number(e.target.value) })}
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              {/* Female Reading Voice Selection in Account Settings */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-stone-300">
                    Giọng đọc Nữ mặc định (6 giọng nữ)
                  </label>
                  <span className="text-[11px] text-purple-400 font-semibold">
                    100% Giọng Nữ
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {FEMALE_VOICE_OPTIONS.map((voice) => {
                    const isSelected = (settings.ttsVoiceId || 'quynh-anh-4-0') === voice.id;
                    return (
                      <button
                        key={voice.id}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            ttsVoiceId: voice.id,
                            ttsRate: voice.baseRate
                          })
                        }
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer min-w-0 ${
                          isSelected
                            ? 'bg-purple-600/25 border-purple-500 text-white'
                            : 'bg-white/5 border-white/10 text-stone-300 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-bold truncate">{voice.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-[10px] font-semibold text-purple-300">
                            {voice.badge}
                          </span>
                          <span className="text-[10px] font-mono-num text-stone-400">
                            Giữ nguyên giọng gốc
                          </span>
                        </div>
                        <p className="text-[10px] text-stone-400 mt-1 line-clamp-1">
                          {voice.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Playback Speed (ttsRate) in Account Settings */}
              <div className="space-y-2.5 p-3.5 rounded-xl bg-white/5 border border-white/10 overflow-hidden min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs min-w-0">
                  <span className="text-stone-300 font-medium truncate min-w-0 flex-1">
                    Tốc độ phát chuẩn YouTube (không biến đổi giọng)
                  </span>
                  <span className="font-mono-num text-purple-400 font-bold shrink-0">
                    {Number(settings.ttsRate || 1.0)
                      .toFixed(2)
                      .replace(/\.00$/, '.0')
                      .replace(/(\.\d)0$/, '$1')}
                    x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={settings.ttsRate || 1.0}
                  onChange={(e) => onUpdateSettings({ ttsRate: Number(e.target.value) })}
                  className="w-full max-w-full block accent-purple-500 cursor-pointer"
                />
                <div className="grid grid-cols-7 gap-1 pt-1 w-full min-w-0">
                  {[0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((preset) => {
                    const isActiveSpeed = Math.abs((settings.ttsRate || 1.0) - preset) < 0.03;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => onUpdateSettings({ ttsRate: preset })}
                        className={`min-w-0 px-0.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-mono-num font-bold transition-all cursor-pointer border truncate text-center ${
                          isActiveSpeed
                            ? 'bg-purple-600 text-white border-purple-500'
                            : 'bg-white/5 border-white/10 text-stone-300 hover:bg-white/10'
                        }`}
                      >
                        {preset === 1.0 ? '1x' : `${preset}x`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white">Tự động chuyển chương mới</p>
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Tự động mở chương kế tiếp khi đọc đến cuối chương
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ autoNextChapter: !settings.autoNextChapter })}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 cursor-pointer ${
                    settings.autoNextChapter ? 'bg-purple-600' : 'bg-stone-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      settings.autoNextChapter ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* 4. DANH HIỆU (10 DANH HIỆU TỪ CẤP 1 ĐẾN 100 - MỖI 10 CẤP 1 DANH HIỆU) */}
          {activeSection === 'title' && (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasLiquidGlass) setAvatarClickBurst((k) => k + 1);
                    }}
                    className={`relative w-11 h-11 rounded-full p-[2.5px] shrink-0 cursor-pointer ${
                      hasLiquidGlass
                        ? `liquid-glass-avatar ${
                            avatarClickBurst > 0 ? 'liquid-glass-avatar-active liquid-glass-avatar-burst' : ''
                          }`
                        : ''
                    } ${activeTitleTheme.ringClass} ${activeTitleTheme.glowClass}`}
                  >
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-[#181824]">
                      <img
                        src={profile.avatarUrl}
                        alt={profile.nickname}
                        className="w-full h-full rounded-full object-cover"
                      />
                      {hasLiquidGlass && <span className="liquid-glass-lens" aria-hidden="true" />}
                    </div>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-stone-400 truncate">Đang trang bị (Viền Avatar đổi theo màu):</p>
                    <p className={`text-sm font-bold truncate ${activeTitleTheme.textClass}`}>
                      {activeTitleTheme.name} ({activeTitleTheme.colorName})
                    </p>
                  </div>
                </div>
                <span className="font-mono-num text-xs font-bold text-stone-300 shrink-0">
                  Lv {profile.level}/100
                </span>
              </div>

              <div className="space-y-2.5">
                {AVAILABLE_TITLES.map((item) => {
                  const isEquipped = activeTitleTheme.name === item.name;
                  const isUnlocked = isAdmin || profile.level >= item.minLevel;
                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-2.5 transition-all ${
                        isEquipped
                          ? 'bg-white/10 border-white/30 shadow-md'
                          : isUnlocked
                            ? 'bg-white/5 border-white/10 hover:bg-white/8'
                            : 'bg-white/[0.02] border-white/5 opacity-60'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        {/* Avatar Ring Color Preview Circle */}
                        <div
                          className={`w-8 h-8 rounded-full p-[2px] shrink-0 mt-0.5 ${item.ringClass} ${item.glowClass}`}
                          title={`Màu viền Avatar: ${item.colorName}`}
                        >
                          <div className="w-full h-full rounded-full bg-[#181824] flex items-center justify-center text-[11px] font-mono-num font-bold text-stone-200">
                            {item.tier}
                          </div>
                        </div>

                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`text-xs sm:text-sm font-bold ${item.textClass}`}>
                              {item.name}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${item.badgeClass}`}>
                              {item.rarity}
                            </span>
                            <span className="text-[10px] font-mono-num text-stone-400">
                              Lv {item.minLevel}–{item.maxLevel}
                            </span>
                          </div>
                          <p className="text-[11px] text-stone-400 leading-relaxed break-words">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!isUnlocked}
                        onClick={() => {
                          if (!isUnlocked) return;
                          onUpdateProfile({
                            equippedTitle: item.name,
                            ...(isAdmin && (profile.level < item.minLevel || profile.level > item.maxLevel)
                              ? { level: item.minLevel, exp: 0 }
                              : {})
                          });
                        }}
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold shrink-0 transition-all ${
                          isEquipped
                            ? `${item.buttonClass} ring-1 ring-white/30 cursor-pointer`
                            : isUnlocked
                              ? 'bg-white/10 text-stone-200 hover:bg-white/20 cursor-pointer'
                              : 'bg-white/5 text-stone-500 border border-white/5 cursor-not-allowed'
                        }`}
                      >
                        {isEquipped ? (
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3 shrink-0" />
                            Đang dùng
                          </span>
                        ) : isUnlocked ? (
                          'Trang bị'
                        ) : (
                          `Cần Lv ${item.minLevel}`
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. TRUNG TÂM QUẢN TRỊ ADMIN (lalhhaa732@gmail.com) */}
          {activeSection === 'admin' && isAdmin && (
            <div className="space-y-4">
              {/* Admin Status Card */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-purple-500/15 to-cyan-500/15 border border-amber-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300 truncate">
                      Quản Trị Viên Tối Cao
                    </span>
                  </div>
                  <p className="text-xs text-stone-200 truncate">
                    Email: <strong className="text-white">{currentUser?.email}</strong>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateProfile({
                      level: 100,
                      exp: getRequiredExpForLevel(100),
                      equippedTitle: 'Vạn Cổ Thư Đế'
                    })
                  }
                  className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-gradient-to-r from-rose-500 via-purple-600 to-cyan-500 text-white text-xs font-bold shadow-lg hover:opacity-95 transition-opacity shrink-0 text-center cursor-pointer"
                >
                  Kích hoạt Lv 100 · Thư Đế
                </button>
              </div>

              {/* Quick Publishing & Broadcast Actions */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-stone-300">Công cụ điều hành nhanh</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPublishModal('novel');
                    }}
                    className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2.5 text-xs font-semibold text-white transition-colors min-w-0 cursor-pointer"
                  >
                    <PlusCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">Đăng truyện gốc mới</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPublishModal('chapter');
                    }}
                    className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2.5 text-xs font-semibold text-white transition-colors min-w-0 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-purple-400 shrink-0" />
                    <span className="truncate">Đăng chương mới</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPublishModal('url');
                    }}
                    className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2.5 text-xs font-semibold text-white transition-colors min-w-0 cursor-pointer"
                  >
                    <Link2 className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="truncate">Nhập truyện từ URL</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onTriggerLiveBroadcast();
                    }}
                    className="p-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 flex items-center gap-2.5 text-xs font-semibold text-amber-200 transition-colors min-w-0 cursor-pointer"
                  >
                    <Radio className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate">Phát sóng chương mới</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPublishModal('github');
                    }}
                    className="sm:col-span-2 p-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 flex items-center justify-center gap-2.5 text-xs font-semibold text-emerald-200 transition-colors min-w-0 cursor-pointer"
                  >
                    <GitBranch className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">Đồng bộ truyện & chương mới lên GitHub (Vercel)</span>
                  </button>
                </div>
              </div>

              {/* Manage Catalog Novels */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-stone-300">
                    Quản lý kho truyện ({novels.length} bộ)
                  </p>
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {novels.map((novel) => (
                    <div
                      key={novel.id}
                      className="p-2.5 sm:p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="text-xs font-bold text-white truncate">{novel.title}</p>
                        <p className="text-[11px] text-stone-400 truncate">
                          {novel.genre} · {novel.chapters.length} chương · {novel.author}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteNovel(novel.id)}
                        className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 transition-colors shrink-0 cursor-pointer"
                        title="Xoá bộ truyện này (Admin)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
