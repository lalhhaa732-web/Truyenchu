import React, { useState, useEffect, useRef } from 'react';
import {
  CircleUser,
  User as UserIcon,
  Settings,
  Bookmark,
  Star,
  LogOut,
  Flame,
  Sparkles,
  Check,
  X,
  BookOpen,
  ShieldCheck,
  Award,
  Heart,
  LogIn
} from 'lucide-react';
import { User } from 'firebase/auth';
import { Novel, ReaderSettings, ReadingProgress } from '../types';

export interface UserProfileData {
  displayName: string;
  level: number;
  exp: number;
  maxExp: number;
  streakDays: number;
  lastCheckInDate: string;
  equippedTitle: string;
  equippedPetId: string;
  ringColor: 'violet' | 'amber' | 'emerald' | 'rose';
  avatarPreset: string;
  bio: string;
  petFedCount: number;
}

const STORAGE_USER_PROFILE_KEY = 'mac_thu_cac_user_profile_v1';

const AVATAR_PRESETS = [
  {
    id: 'crimson-scholar',
    name: 'Huyết Mặc Thư Sinh',
    svgBg: 'from-[#3b1d2e] via-[#5c2a42] to-[#1e1324]',
    accent: '#f472b6'
  },
  {
    id: 'jade-immortal',
    name: 'Thanh Vân Kiếm Khách',
    svgBg: 'from-[#0f2922] via-[#1b4338] to-[#091714]',
    accent: '#34d399'
  },
  {
    id: 'astral-sage',
    name: 'Tinh Hà Quan Tinh',
    svgBg: 'from-[#17163b] via-[#2b2968] to-[#0d0c24]',
    accent: '#818cf8'
  },
  {
    id: 'golden-emperor',
    name: 'Kim Đan Đạo Nhân',
    svgBg: 'from-[#3b2610] via-[#633f18] to-[#1f1308]',
    accent: '#fbbf24'
  }
];

const TITLES_LIST = [
  {
    id: 'ung-nhan',
    name: 'Ưng Nhãn',
    description: 'Thấu thị vạn quyển thư, không bỏ sót bất kỳ chương mới nào.',
    minLevel: 1,
    badgeColor: 'text-amber-400 border-amber-500/40 bg-amber-500/10'
  },
  {
    id: 'kiem-tam',
    name: 'Kiếm Tâm Thông Minh',
    description: 'Tâm sáng như gương, đọc thông hiểu thấu kiếm đạo nhân sinh.',
    minLevel: 10,
    badgeColor: 'text-sky-400 border-sky-500/40 bg-sky-500/10'
  },
  {
    id: 'van-quyen',
    name: 'Vạn Quyển Độc Giả',
    description: 'Đã lật giở hàng vạn trang sách giữa đêm khuya.',
    minLevel: 15,
    badgeColor: 'text-purple-400 border-purple-500/40 bg-purple-500/10'
  },
  {
    id: 'thien-co',
    name: 'Thiên Cơ Các Chủ',
    description: 'Nắm giữ nguồn truyện tự động từ khắp cõi mạng.',
    minLevel: 20,
    badgeColor: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
  },
  {
    id: 'dao-to',
    name: 'Đạo Tổ Thư Các',
    description: 'Cảnh giới tối cao của người luyện đạo đọc truyện.',
    minLevel: 30,
    badgeColor: 'text-rose-400 border-rose-500/40 bg-rose-500/10'
  }
];

const SPIRIT_PETS = [
  {
    id: 'huyen-mieu',
    name: 'Huyền Miêu U Linh',
    stage: 'Linh Thú Cấp 4',
    bonus: '+15% EXP khi đọc tự động',
    element: 'Ám Nguyệt',
    color: 'from-violet-600/30 to-fuchsia-900/40 border-violet-500/40',
    iconColor: 'text-violet-400'
  },
  {
    id: 'thanh-loan',
    name: 'Thanh Loan Hỏa Phượng',
    stage: 'Thần Thú Cấp 6',
    bonus: '+25% EXP khi điểm danh liên tiếp',
    element: 'Chân Hỏa',
    color: 'from-amber-600/30 to-orange-900/40 border-amber-500/40',
    iconColor: 'text-amber-400'
  },
  {
    id: 'cuu-vi',
    name: 'Bạch Hồ Cửu Vĩ',
    stage: 'Tiên Thú Cấp 5',
    bonus: 'Tự động tích lũy linh khí mỗi chương',
    element: 'Băng Tâm',
    color: 'from-sky-600/30 to-indigo-900/40 border-sky-500/40',
    iconColor: 'text-sky-400'
  },
  {
    id: 'mac-ky-lan',
    name: 'Mặc Ngọc Kỳ Lân',
    stage: 'Thánh Thú Cấp 7',
    bonus: '+30% EXP toàn diện',
    element: 'Thủy Mặc',
    color: 'from-emerald-600/30 to-teal-900/40 border-emerald-500/40',
    iconColor: 'text-emerald-400'
  }
];

export type ProfileModalSection =
  | 'account'
  | 'profile'
  | 'settings'
  | 'follows'
  | 'pets'
  | 'titles'
  | null;

interface AvatarProfileMenuProps {
  currentUser: User | null;
  novels: Novel[];
  bookmarkedIds: string[];
  progressMap: Record<string, ReadingProgress>;
  settings: ReaderSettings;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onOpenReader: (novelId: string, chapterNumber?: number) => void;
  onToggleBookmark: (novelId: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export const AvatarProfileMenu: React.FC<AvatarProfileMenuProps> = ({
  currentUser,
  novels,
  bookmarkedIds,
  progressMap,
  settings,
  onUpdateSettings,
  onOpenReader,
  onToggleBookmark,
  onSignIn,
  onSignOut
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeModalSection, setActiveModalSection] = useState<ProfileModalSection>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<UserProfileData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_USER_PROFILE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {
      displayName: 'Không còn não',
      level: 22,
      exp: 2450,
      maxExp: 3000,
      streakDays: 2,
      lastCheckInDate: '',
      equippedTitle: 'Ưng Nhãn',
      equippedPetId: 'huyen-mieu',
      ringColor: 'violet',
      avatarPreset: 'crimson-scholar',
      bio: 'Lấy sách làm bạn, lấy đạo làm nhà. Đọc vạn quyển thư, hành vạn dặm đường.',
      petFedCount: 12
    };
  });

  // Sync display name from Firebase user if newly signed in and still using default
  useEffect(() => {
    if (currentUser?.displayName && profile.displayName === 'Không còn não') {
      setProfile((prev) => ({
        ...prev,
        displayName: currentUser.displayName || prev.displayName
      }));
    }
  }, [currentUser]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_USER_PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // ignore
    }
  }, [profile]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const showTempToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2600);
  };

  const handleDailyCheckIn = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (profile.lastCheckInDate === today) {
      showTempToast('Hôm nay đạo hữu đã điểm danh rồi!');
      return;
    }
    setProfile((prev) => {
      const nextExp = prev.exp + 150;
      const leveledUp = nextExp >= prev.maxExp;
      return {
        ...prev,
        streakDays: prev.streakDays + 1,
        lastCheckInDate: today,
        level: leveledUp ? prev.level + 1 : prev.level,
        exp: leveledUp ? nextExp - prev.maxExp : nextExp
      };
    });
    showTempToast('Điểm danh thành công! +150 EXP & tăng chuỗi ngày liên tiếp.');
  };

  const handleFeedPet = () => {
    setProfile((prev) => {
      const nextExp = prev.exp + 80;
      const leveledUp = nextExp >= prev.maxExp;
      return {
        ...prev,
        petFedCount: prev.petFedCount + 1,
        level: leveledUp ? prev.level + 1 : prev.level,
        exp: leveledUp ? nextExp - prev.maxExp : nextExp
      };
    });
    showTempToast('Đã cho Linh Thú ăn Linh Đan! +80 EXP tu vi.');
  };

  const ringStyleMap = {
    violet: 'ring-2 ring-[#7c5cff] shadow-[0_0_12px_rgba(124,92,255,0.45)]',
    amber: 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]',
    emerald: 'ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.45)]',
    rose: 'ring-2 ring-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.45)]'
  };

  const activePreset =
    AVATAR_PRESETS.find((p) => p.id === profile.avatarPreset) || AVATAR_PRESETS[0];

  const activePet =
    SPIRIT_PETS.find((p) => p.id === profile.equippedPetId) || SPIRIT_PETS[0];

  const renderAvatarGraphic = (sizeClass: string) => {
    if (currentUser?.photoURL) {
      return (
        <div
          className={`${sizeClass} rounded-full relative overflow-hidden shrink-0 ${ringStyleMap[profile.ringColor]}`}
        >
          <img
            src={currentUser.photoURL}
            alt={profile.displayName}
            className="w-full h-full rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      );
    }

    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br ${activePreset.svgBg} ${ringStyleMap[profile.ringColor]} relative overflow-hidden flex items-center justify-center shrink-0 select-none`}
      >
        {/* Illustrated Anime/Eastern Scholar Silhouette */}
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <defs>
            <radialGradient id={`glow-${activePreset.id}`} cx="50%" cy="35%" r="60%">
              <stop offset="0%" stopColor={activePreset.accent} stopOpacity="0.45" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="50" fill={`url(#glow-${activePreset.id})`} />
          {/* Soft warm skin & hair illustration */}
          <path
            d="M22 92 C25 68 75 68 78 92 Z"
            fill="#271722"
            stroke={activePreset.accent}
            strokeWidth="1.5"
            strokeOpacity="0.5"
          />
          <circle cx="50" cy="44" r="17" fill="#fbd3c4" />
          {/* Stylish bangs and hair */}
          <path
            d="M30 44 C28 22 72 22 70 44 C67 33 58 30 50 32 C42 30 33 34 30 44 Z"
            fill="#3a1d28"
          />
          {/* Expressive eyes & blush */}
          <ellipse cx="43" cy="46" rx="2.2" ry="2.8" fill="#2d141c" />
          <ellipse cx="57" cy="46" rx="2.2" ry="2.8" fill="#2d141c" />
          <circle cx="43.8" cy="45" r="0.8" fill="#ffffff" />
          <circle cx="57.8" cy="45" r="0.8" fill="#ffffff" />
          <ellipse cx="39" cy="50" rx="3" ry="1.5" fill="#f43f5e" fillOpacity="0.45" />
          <ellipse cx="61" cy="50" rx="3" ry="1.5" fill="#f43f5e" fillOpacity="0.45" />
          <path
            d="M47 53 Q50 55.5 53 53"
            fill="none"
            stroke="#9f1239"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  };

  const openSection = (section: ProfileModalSection) => {
    setIsDropdownOpen(false);
    setActiveModalSection(section);
  };

  const bookmarkedNovels = novels.filter((n) => bookmarkedIds.includes(n.id));
  const totalReadChapters = Object.values(progressMap).reduce(
    (acc, item) => acc + (item.chapterNumber || 1),
    0
  );

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Top Bar Avatar Ring Trigger Button */}
      <div className="relative flex items-center justify-center">
        <button
          type="button"
          onClick={() => {
            setIsDropdownOpen((prev) => !prev);
          }}
          className="relative flex items-center justify-center rounded-full p-0.5 cursor-pointer focus:outline-none transition-transform active:scale-95"
          aria-label="Mở menu tài khoản"
          title={`${profile.displayName} (Lv ${profile.level} · ${profile.equippedTitle})`}
        >
          {renderAvatarGraphic('w-9 h-9')}
          {/* Online / Active Streak Dot */}
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#FBF9F5] dark:border-[#0C0A09] z-30" />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isDropdownOpen && (
        <div
          className="absolute right-0 mt-3 w-76 sm:w-80 rounded-2xl text-stone-100 z-50 overflow-hidden bg-[#181B23] border border-[#2A2F3D] shadow-[0_20px_50px_rgba(0,0,0,0.65)]"
        >
          {/* Top Profile Header inside Dropdown */}
          <div className="p-4 flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => {
                openSection('profile');
              }}
              className="shrink-0 cursor-pointer"
            >
              {renderAvatarGraphic('w-14 h-14')}
            </button>

            <div className="min-w-0 flex-1">
              <h3 className="font-sans text-base font-bold text-white truncate">
                {profile.displayName}
              </h3>
              <p className="text-xs text-[#9BA3B8] mt-0.5 truncate">
                Lv {profile.level} <span className="mx-0.5">·</span> {profile.equippedTitle}
              </p>
              <button
                type="button"
                onClick={handleDailyCheckIn}
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#F97316] hover:text-orange-400 transition-colors cursor-pointer"
                title="Nhấn để điểm danh nhận EXP mỗi ngày"
              >
                <Flame className="w-3.5 h-3.5 fill-orange-500/20" />
                <span>{profile.streakDays} ngày liên tiếp</span>
              </button>
            </div>
          </div>

          <div className="mx-4 border-t border-[#2A2F3D]" />

          {/* 6 Functional Menu Items matching the screenshot */}
          <div className="py-2 px-2 space-y-0.5">
            <button
              type="button"
              onClick={() => openSection('account')}
              className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-[#E2E8F0] hover:bg-[#232834] hover:text-white transition-colors cursor-pointer"
            >
              <CircleUser className="w-5 h-5 text-[#9BA3B8] shrink-0" />
              <span>Tài khoản của tôi</span>
            </button>

            <button
              type="button"
              onClick={() => openSection('profile')}
              className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-[#E2E8F0] hover:bg-[#232834] hover:text-white transition-colors cursor-pointer"
            >
              <UserIcon className="w-5 h-5 text-[#9BA3B8] shrink-0" />
              <span>Hồ sơ của tôi</span>
            </button>

            <button
              type="button"
              onClick={() => openSection('settings')}
              className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-[#E2E8F0] hover:bg-[#232834] hover:text-white transition-colors cursor-pointer"
            >
              <Settings className="w-5 h-5 text-[#9BA3B8] shrink-0" />
              <span>Cài đặt tài khoản</span>
            </button>

            <button
              type="button"
              onClick={() => openSection('follows')}
              className="w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm font-medium text-[#E2E8F0] hover:bg-[#232834] hover:text-white transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Bookmark className="w-5 h-5 text-[#9BA3B8] shrink-0" />
                <span>Theo dõi</span>
              </div>
              <span className="text-xs font-mono-num px-2 py-0.5 rounded-md bg-[#232834] text-[#9BA3B8]">
                {bookmarkedIds.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openSection('pets')}
              className="w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm font-medium text-[#E2E8F0] hover:bg-[#232834] hover:text-white transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Sparkles className="w-5 h-5 text-[#9BA3B8] shrink-0" />
                <span>Thú cưng</span>
              </div>
              <span className="text-[11px] text-violet-400 font-medium truncate max-w-[110px]">
                {activePet.name}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openSection('titles')}
              className="w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm font-medium text-[#E2E8F0] hover:bg-[#232834] hover:text-white transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <Star className="w-5 h-5 text-[#9BA3B8] shrink-0" />
                <span>Danh hiệu</span>
              </div>
              <span className="text-[11px] text-amber-400 font-medium">
                {profile.equippedTitle}
              </span>
            </button>
          </div>

          <div className="mx-4 border-t border-[#2A2F3D]" />

          {/* Bottom Logout / Auth Action */}
          <div className="p-2">
            <button
              type="button"
              onClick={() => {
                setIsDropdownOpen(false);
                if (currentUser) {
                  onSignOut();
                  showTempToast('Đã đăng xuất khỏi tài khoản đám mây.');
                } else {
                  showTempToast('Đã làm mới phiên tài khoản khách.');
                }
              }}
              className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-[#F87171] hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating feedback toast */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-[#181B23] text-white text-xs font-medium border border-violet-500/40 shadow-xl flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Full Interactive Modal for the 6 Avatar Menu Sections */}
      {activeModalSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-[#181B23] text-stone-100 border border-[#2A2F3D] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            {/* Modal Top Header */}
            <div className="px-6 py-4 border-b border-[#2A2F3D] flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {renderAvatarGraphic('w-10 h-10')}
                <div>
                  <h2 className="font-sans text-base font-bold text-white">
                    {profile.displayName}
                  </h2>
                  <p className="text-xs text-[#9BA3B8]">
                    Lv {profile.level} · {profile.equippedTitle} ·{' '}
                    <span className="text-orange-400">{profile.streakDays} ngày liên tiếp</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveModalSection(null)}
                className="p-2 rounded-lg text-stone-400 hover:text-white hover:bg-[#232834] transition-colors cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Section Navigation Pills inside Modal */}
            <div className="px-6 py-2.5 bg-[#12151B] border-b border-[#2A2F3D] flex items-center gap-1.5 overflow-x-auto">
              {[
                { id: 'account', label: 'Tài khoản của tôi', icon: CircleUser },
                { id: 'profile', label: 'Hồ sơ của tôi', icon: UserIcon },
                { id: 'settings', label: 'Cài đặt tài khoản', icon: Settings },
                { id: 'follows', label: 'Theo dõi', icon: Bookmark },
                { id: 'pets', label: 'Thú cưng', icon: Sparkles },
                { id: 'titles', label: 'Danh hiệu', icon: Star }
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeModalSection === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveModalSection(tab.id as ProfileModalSection)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[#7c5cff] text-white'
                        : 'text-[#9BA3B8] hover:text-white hover:bg-[#232834]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* 1. TÀI KHOẢN CỦA TÔI */}
              {activeModalSection === 'account' && (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl bg-[#202430] border border-[#2E3446] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#9BA3B8]">
                        Cấp độ tu vi & Kinh nghiệm
                      </span>
                      <span className="text-xs font-mono-num text-violet-400 font-semibold">
                        Lv {profile.level} ({profile.exp} / {profile.maxExp} EXP)
                      </span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-[#12151B] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-500 to-amber-400 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.round((profile.exp / profile.maxExp) * 100))}%`
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1.5 text-xs text-orange-400 font-medium">
                        <Flame className="w-4 h-4 fill-orange-500/20" />
                        <span>Chuỗi đọc: {profile.streakDays} ngày liên tiếp</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleDailyCheckIn}
                        className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Điểm danh hôm nay (+150 EXP)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-[#202430] border border-[#2E3446]">
                      <p className="text-[11px] text-[#9BA3B8]">Truyện theo dõi</p>
                      <p className="text-xl font-bold text-white mt-1 font-mono-num">
                        {bookmarkedIds.length}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-[#202430] border border-[#2E3446]">
                      <p className="text-[11px] text-[#9BA3B8]">Chương đã đọc</p>
                      <p className="text-xl font-bold text-white mt-1 font-mono-num">
                        {totalReadChapters}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-[#202430] border border-[#2E3446]">
                      <p className="text-[11px] text-[#9BA3B8]">Linh thú đồng hành</p>
                      <p className="text-sm font-bold text-violet-400 mt-1.5 truncate">
                        {activePet.name}
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-[#202430] border border-[#2E3446] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-semibold text-white">
                          Liên kết đám mây Firebase
                        </span>
                      </div>
                      <p className="text-xs text-[#9BA3B8]">
                        {currentUser
                          ? `Đã đồng bộ với Google (${currentUser.email})`
                          : 'Đăng nhập Google để đồng bộ tủ sách và cấp độ trên mọi thiết bị.'}
                      </p>
                    </div>

                    {currentUser ? (
                      <button
                        type="button"
                        onClick={onSignOut}
                        className="px-3.5 py-2 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        Ngắt kết nối
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onSignIn}
                        className="px-4 py-2 rounded-xl bg-white text-stone-950 hover:bg-stone-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Liên kết Google</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* 2. HỒ SƠ CỦA TÔI */}
              {activeModalSection === 'profile' && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-[#9BA3B8]">
                      Biệt danh hiển thị
                    </label>
                    <input
                      type="text"
                      value={profile.displayName}
                      onChange={(e) =>
                        setProfile((prev) => ({ ...prev, displayName: e.target.value }))
                      }
                      className="w-full h-10 px-3.5 rounded-xl bg-[#12151B] border border-[#2E3446] text-sm text-white focus:outline-none focus:border-violet-500"
                      placeholder="Nhập biệt danh..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-[#9BA3B8]">
                      Châm ngôn đạo hữu
                    </label>
                    <textarea
                      rows={2}
                      value={profile.bio}
                      onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))}
                      className="w-full p-3.5 rounded-xl bg-[#12151B] border border-[#2E3446] text-xs text-stone-200 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div className="space-y-2.5">
                    <label className="block text-xs font-medium text-[#9BA3B8]">
                      Chọn hình đại diện & Vòng hào quang Avatar
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {AVATAR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            setProfile((prev) => ({ ...prev, avatarPreset: preset.id }))
                          }
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col items-center gap-2 ${
                            profile.avatarPreset === preset.id
                              ? 'border-violet-500 bg-violet-500/10'
                              : 'border-[#2E3446] bg-[#202430] hover:border-stone-600'
                          }`}
                        >
                          <div
                            className={`w-10 h-10 rounded-full bg-gradient-to-br ${preset.svgBg} ring-2 ring-white/20`}
                          />
                          <span className="text-[11px] font-medium text-center text-stone-200">
                            {preset.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-[#9BA3B8]">
                      Màu viền vòng Avatar
                    </label>
                    <div className="flex items-center gap-3">
                      {(
                        [
                          { id: 'violet', label: 'Tím Tinh Hà', dot: 'bg-[#7c5cff]' },
                          { id: 'amber', label: 'Kim Đan', dot: 'bg-amber-400' },
                          { id: 'emerald', label: 'Ngọc Bích', dot: 'bg-emerald-400' },
                          { id: 'rose', label: 'Huyết Nguyệt', dot: 'bg-rose-400' }
                        ] as const
                      ).map((ring) => (
                        <button
                          key={ring.id}
                          type="button"
                          onClick={() =>
                            setProfile((prev) => ({ ...prev, ringColor: ring.id }))
                          }
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 cursor-pointer ${
                            profile.ringColor === ring.id
                              ? 'border-white bg-white/10 text-white'
                              : 'border-[#2E3446] bg-[#202430] text-[#9BA3B8]'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${ring.dot}`} />
                          <span>{ring.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 3. CÀI ĐẶT TÀI KHOẢN */}
              {activeModalSection === 'settings' && (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl bg-[#202430] border border-[#2E3446] space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Chế độ màu nền đọc sách</p>
                        <p className="text-xs text-[#9BA3B8]">
                          Đồng bộ màu nền giữa trang chủ và trình đọc
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-[#12151B] p-1 rounded-lg">
                        {(
                          [
                            { id: 'light', label: 'Sáng' },
                            { id: 'sepia', label: 'Sepia' },
                            { id: 'dark', label: 'Tối' }
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onUpdateSettings({ theme: t.id })}
                            className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                              settings.theme === t.id
                                ? 'bg-[#7c5cff] text-white'
                                : 'text-[#9BA3B8] hover:text-white'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-[#2E3446] pt-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">Cỡ chữ mặc định</p>
                        <p className="text-xs text-[#9BA3B8]">Hiện tại: {settings.fontSize}px</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ fontSize: Math.max(15, settings.fontSize - 1) })
                          }
                          className="w-8 h-8 rounded-lg bg-[#12151B] border border-[#2E3446] text-white font-bold cursor-pointer"
                        >
                          -
                        </button>
                        <span className="w-10 text-center text-xs font-mono-num">
                          {settings.fontSize}px
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ fontSize: Math.min(26, settings.fontSize + 1) })
                          }
                          className="w-8 h-8 rounded-lg bg-[#12151B] border border-[#2E3446] text-white font-bold cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-[#2E3446] pt-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          Tự động chuyển chương mới
                        </p>
                        <p className="text-xs text-[#9BA3B8]">
                          Tự chuyển sang chương kế tiếp khi đọc tới cuối chương
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ autoNextChapter: !settings.autoNextChapter })
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                          settings.autoNextChapter
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-[#12151B] text-[#9BA3B8] border border-[#2E3446]'
                        }`}
                      >
                        {settings.autoNextChapter ? 'Đang bật' : 'Đang tắt'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. THEO DÕI */}
              {activeModalSection === 'follows' && (
                <div className="space-y-3">
                  {bookmarkedNovels.length === 0 ? (
                    <div className="py-10 text-center text-xs text-[#9BA3B8]">
                      Bạn chưa theo dõi truyện nào. Hãy nhấn biểu tượng đánh dấu trên thẻ truyện.
                    </div>
                  ) : (
                    bookmarkedNovels.map((novel) => {
                      const prog = progressMap[novel.id];
                      const latest = novel.chapters[novel.chapters.length - 1];
                      return (
                        <div
                          key={novel.id}
                          className="p-3.5 rounded-xl bg-[#202430] border border-[#2E3446] flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-white truncate">
                              {novel.title}
                            </h4>
                            <p className="text-xs text-[#9BA3B8] mt-0.5">
                              {novel.genre} · Đang đọc C.{prog?.chapterNumber || 1} / Mới nhất C.
                              {latest.number}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveModalSection(null);
                                onOpenReader(novel.id, prog?.chapterNumber || 1);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-[#7c5cff] hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                            >
                              <BookOpen className="w-3.5 h-3.5" />
                              <span>Đọc tiếp</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleBookmark(novel.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-[#2E3446] text-xs text-[#9BA3B8] hover:text-rose-400 cursor-pointer"
                            >
                              Bỏ lưu
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* 5. THÚ CƯNG */}
              {activeModalSection === 'pets' && (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl bg-gradient-to-r from-violet-950/60 to-indigo-950/60 border border-violet-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">
                        Linh thú đang đồng hành
                      </span>
                      <h3 className="text-lg font-bold text-white">{activePet.name}</h3>
                      <p className="text-xs text-stone-300">
                        {activePet.stage} · Hệ {activePet.element} · {activePet.bonus}
                      </p>
                      <p className="text-[11px] text-amber-400 pt-0.5">
                        Đã cho ăn: {profile.petFedCount} lần Linh Đan
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleFeedPet}
                      className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Heart className="w-3.5 h-3.5 fill-white/20" />
                      <span>Cho ăn Linh Đan (+80 EXP)</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {SPIRIT_PETS.map((pet) => {
                      const isEquipped = profile.equippedPetId === pet.id;
                      return (
                        <div
                          key={pet.id}
                          className={`p-4 rounded-xl bg-gradient-to-br ${pet.color} border flex flex-col justify-between gap-3`}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-semibold ${pet.iconColor}`}>
                                {pet.stage}
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-black/30 text-stone-300">
                                Hệ {pet.element}
                              </span>
                            </div>
                            <h4 className="text-base font-bold text-white mt-1">{pet.name}</h4>
                            <p className="text-xs text-stone-300 mt-1">{pet.bonus}</p>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setProfile((prev) => ({ ...prev, equippedPetId: pet.id }));
                              showTempToast(`Đã triệu hồi ${pet.name} đồng hành!`);
                            }}
                            className={`w-full py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                              isEquipped
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-white/10 hover:bg-white/20 text-white'
                            }`}
                          >
                            {isEquipped ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Đang đồng hành</span>
                              </>
                            ) : (
                              <span>Triệu hồi</span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 6. DANH HIỆU */}
              {activeModalSection === 'titles' && (
                <div className="space-y-3">
                  {TITLES_LIST.map((titleItem) => {
                    const isEquipped = profile.equippedTitle === titleItem.name;
                    return (
                      <div
                        key={titleItem.id}
                        className="p-4 rounded-xl bg-[#202430] border border-[#2E3446] flex items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-0.5 rounded-md border text-xs font-semibold flex items-center gap-1 ${titleItem.badgeColor}`}
                            >
                              <Award className="w-3.5 h-3.5" />
                              {titleItem.name}
                            </span>
                            <span className="text-[11px] text-[#9BA3B8]">
                              Yêu cầu: Lv {titleItem.minLevel}
                            </span>
                          </div>
                          <p className="text-xs text-stone-300">{titleItem.description}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setProfile((prev) => ({
                              ...prev,
                              equippedTitle: titleItem.name
                            }));
                            showTempToast(`Đã trang bị danh hiệu "${titleItem.name}"!`);
                          }}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 cursor-pointer ${
                            isEquipped
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-[#7c5cff] hover:bg-violet-500 text-white'
                          }`}
                        >
                          {isEquipped ? 'Đang dùng' : 'Trang bị'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
