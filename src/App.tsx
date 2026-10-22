import React, { useEffect, useState, useRef } from 'react';
import {
  BookOpen,
  Radio,
  Search,
  Sparkles,
  Clock,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  RefreshCw,
  Moon,
  Sun,
  Menu,
  X,
  History,
  LogIn,
  LogOut,
  UserCircle,
  User as UserIcon,
  Settings,
  Star,
  UserPlus,
  Crown,
  ImagePlus,
  Palette
} from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  auth,
  db,
  isAdminUser,
  signInWithGoogle,
  signOutUser,
  syncUserProfileToFirestore,
  syncNovelAndChapterToFirestore,
  deleteNovelFromFirestore,
  syncUserProgressToFirestore,
  handleFirestoreError,
  OperationType
} from './firebase';
import { Novel, RealtimeUpdateEvent, ReaderSettings, ReadingProgress } from './types';
import { INITIAL_NOVELS, SAMPLE_NOVEL_IDS } from './data/seedNovels';
import {
  BookCoverArtwork,
  BookCoverEditorModal,
  compressBookCoverFile
} from './components/BookCoverArtwork';
import { ReaderView } from './components/ReaderView';
import { PublishChapterModal, CreateNovelPayload, ImportUrlPayload } from './components/PublishChapterModal';
import {
  UserProfileModal,
  ProfileSectionType,
  UserProfileData,
  PRESET_AVATARS,
  AVAILABLE_TITLES,
  getTitleTheme,
  getTitleForLevel,
  hasLiquidGlassEffect,
  getRequiredExpForLevel,
  getReadingExpRule
} from './components/UserProfileModal';
import { AuthGoogleModal, AuthModalMode } from './components/AuthGoogleModal';

const STORAGE_SETTINGS_KEY = 'mac_thu_cac_reader_settings_v1';
const STORAGE_PROGRESS_KEY = 'mac_thu_cac_reading_progress_v2';
const STORAGE_BOOKMARKS_KEY = 'mac_thu_cac_bookmarks_v2';
const STORAGE_PROFILE_KEY = 'mac_thu_cac_user_profile_v1';
const STORAGE_COVERS_KEY = 'mac_thu_cac_novel_covers_v2';
const STORAGE_READING_SECONDS_KEY = 'mac_thu_cac_reading_cycle_sec_v1';

interface SavedCoverOverride {
  coverStyle?: Novel['coverStyle'];
  coverImageUrl?: string;
}

function loadSavedCoverOverrides(): Record<string, SavedCoverOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_COVERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function normalizeNovelChapters(novel: Novel): Novel {
  const byNumber = new Map<number, Novel['chapters'][number]>();
  for (const ch of novel.chapters || []) {
    const num = Number(ch.number) || 1;
    const existing = byNumber.get(num);
    if (!existing || (ch.content?.length || 0) >= (existing.content?.length || 0)) {
      byNumber.set(num, { ...ch, number: num });
    }
  }
  const sortedChapters = Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
  return {
    ...novel,
    chapters: sortedChapters
  };
}

function applyCoverOverrides(list: Novel[]): Novel[] {
  const overrides = loadSavedCoverOverrides();
  return list.map((rawNovel) => {
    const novel = normalizeNovelChapters(rawNovel);
    const ov = overrides[novel.id];
    if (!ov) return novel;
    return {
      ...novel,
      coverStyle: ov.coverStyle || novel.coverStyle,
      coverImageUrl: ov.coverImageUrl !== undefined ? ov.coverImageUrl || undefined : novel.coverImageUrl
    };
  });
}

export default function App() {
  const [novels, setNovels] = useState<Novel[]>(() => applyCoverOverrides(INITIAL_NOVELS));
  const [editingCoverNovelId, setEditingCoverNovelId] = useState<string | null>(null);
  const featuredCoverInputRef = useRef<HTMLInputElement | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [activeReaders, setActiveReaders] = useState<number>(1);
  const [syncingNovelId, setSyncingNovelId] = useState<string | null>(null);

  // Firebase Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>(null);

  // Top-right Avatar Dropdown & Profile Modal state
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState<boolean>(false);
  const [avatarBurstKey, setAvatarBurstKey] = useState<number>(0);
  const [activeProfileSection, setActiveProfileSection] = useState<ProfileSectionType>(null);
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);

  // Persistent User Profile Data (Level 1 to 100, 10 titles - 1 every 10 levels)
  const [userProfile, setUserProfile] = useState<UserProfileData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PROFILE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const clampedLevel = Math.max(1, Math.min(100, Number(parsed.level) || 1));
        const theme = getTitleTheme(parsed.equippedTitle, clampedLevel);
        return {
          ...parsed,
          level: clampedLevel,
          equippedTitle: theme.name,
          unlockedTitles: AVAILABLE_TITLES.map((t) => t.name)
        };
      }
    } catch {
      // ignore
    }
    return {
      nickname: 'Không còn não',
      avatarUrl: PRESET_AVATARS[0],
      bio: 'Độc giả đam mê Tiên Hiệp, Kỳ Ảo Cổ Phong và Huyền Huyễn.',
      level: 1,
      exp: 0,
      equippedTitle: AVAILABLE_TITLES[0].name,
      unlockedTitles: AVAILABLE_TITLES.map((t) => t.name)
    };
  });

  const activeTitleTheme = getTitleTheme(userProfile.equippedTitle, userProfile.level);
  const hasLiquidGlass = hasLiquidGlassEffect(userProfile.level);
  const isAdmin = isAdminUser(currentUser);

  // Active reading time counter (in seconds) for automatic EXP progression
  const [readingSecondsInCycle, setReadingSecondsInCycle] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_READING_SECONDS_KEY);
      return saved ? Math.max(0, Math.floor(Number(saved) || 0)) : 0;
    } catch {
      return 0;
    }
  });
  const [expGainToast, setExpGainToast] = useState<string | null>(null);

  // Navigation & Drawer state
  const [activeTab, setActiveTab] = useState<'discover' | 'updates' | 'library'>('discover');
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isLogOpen, setIsLogOpen] = useState<boolean>(false);
  const [selectedGenre, setSelectedGenre] = useState<string>('Tất cả');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [readingState, setReadingState] = useState<{ novelId: string; chapterNumber: number } | null>(null);
  const [modalState, setModalState] = useState<{ isOpen: boolean; mode: 'url' | 'novel' | 'chapter' }>({
    isOpen: false,
    mode: 'url'
  });

  // Real-time toast alert
  const [newChapterAlert, setNewChapterAlert] = useState<{
    novelId: string;
    novelTitle: string;
    chapterNumber: number;
    title: string;
  } | null>(null);

  // Persistent reader settings & dark mode
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          theme: 'light',
          fontFamily: 'serif',
          fontSize: 19,
          lineHeight: 1.8,
          autoScrollSpeed: 3,
          autoNextChapter: true,
          ttsRate: 1.0,
          ...parsed,
          ttsVoiceId: parsed.ttsVoiceId || 'quynh-anh-4-0'
        };
      }
    } catch {
      // ignore
    }
    return {
      theme: 'light',
      fontFamily: 'serif',
      fontSize: 19,
      lineHeight: 1.8,
      autoScrollSpeed: 3,
      autoNextChapter: true,
      ttsRate: 1.0,
      ttsVoiceId: 'quynh-anh-4-0'
    };
  });

  // Reading history progress map
  const [progressMap, setProgressMap] = useState<Record<string, ReadingProgress>>(() => {
    try {
      localStorage.removeItem('mac_thu_cac_reading_progress_v1');
      localStorage.removeItem('mac_thu_cac_bookmarks_v1');
      localStorage.removeItem('mac_thu_cac_novel_covers_v1');
      const saved = localStorage.getItem(STORAGE_PROGRESS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {};
  });

  // Bookmarked novels
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_BOOKMARKS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  const wsRef = useRef<WebSocket | null>(null);
  const genreRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollGenreRow = (genreName: string, direction: 'left' | 'right') => {
    const container = genreRowRefs.current[genreName];
    if (!container) return;
    const offset = direction === 'left' ? -340 : 340;
    container.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const updateUserProfile = (partial: Partial<UserProfileData>) => {
    setUserProfile((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      syncUserProfileToFirestore(next, true).catch(() => {});
      return next;
    });
  };

  const handleAuthenticateGoogle = async (
    mode: 'login' | 'register',
    registrationData?: Partial<UserProfileData>
  ) => {
    const cred = await signInWithGoogle(mode === 'register');
    const signedInUser = cred.user;
    if (!signedInUser) return;

    const mergedProfile: UserProfileData = {
      ...userProfile,
      nickname:
        registrationData?.nickname ||
        (userProfile.nickname !== 'Không còn não' ? userProfile.nickname : signedInUser.displayName || 'Không còn não'),
      avatarUrl:
        userProfile.avatarUrl && userProfile.avatarUrl !== PRESET_AVATARS[0]
          ? userProfile.avatarUrl
          : signedInUser.photoURL || userProfile.avatarUrl,
      ...(registrationData?.equippedTitle ? { equippedTitle: registrationData.equippedTitle } : {})
    };

    const synced = await syncUserProfileToFirestore(mergedProfile, mode === 'register');
    const finalProfile = synced || mergedProfile;

    setUserProfile(finalProfile);
    try {
      localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(finalProfile));
    } catch {
      // ignore
    }
  };

  // Close avatar dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(event.target as Node)) {
        setIsAvatarMenuOpen(false);
      }
    };
    if (isAvatarMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAvatarMenuOpen]);

  // Track Firebase Authentication state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
      if (user) {
        setUserProfile((prev) => {
          const initialMerged: UserProfileData = {
            ...prev,
            nickname: prev.nickname === 'Không còn não' && user.displayName ? user.displayName : prev.nickname,
            avatarUrl:
              prev.avatarUrl && prev.avatarUrl !== PRESET_AVATARS[0]
                ? prev.avatarUrl
                : user.photoURL || prev.avatarUrl
          };
          syncUserProfileToFirestore(initialMerged, false)
            .then((cloudProfile) => {
              if (cloudProfile) {
                setUserProfile(cloudProfile);
                try {
                  localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(cloudProfile));
                } catch {
                  // ignore
                }
              }
            })
            .catch(() => {});
          return initialMerged;
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time Firestore listener for authenticated user's reading progress & bookmarks
  useEffect(() => {
    if (!isAuthReady || !currentUser) return;

    const progressPath = `users/${currentUser.uid}/progress`;
    const q = query(
      collection(db, 'users', currentUser.uid, 'progress'),
      where('userId', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const cloudBookmarks: string[] = [];
        const cloudProgress: Record<string, ReadingProgress> = {};

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.novelId && !SAMPLE_NOVEL_IDS.includes(data.novelId)) {
            if (data.isBookmarked) {
              cloudBookmarks.push(data.novelId);
            }
            cloudProgress[data.novelId] = {
              novelId: data.novelId,
              chapterId: `${data.novelId}-c${data.chapterNumber || 1}`,
              chapterNumber: data.chapterNumber || 1,
              scrollPercentage: 0,
              updatedAt: new Date().toISOString()
            };
          }
        });

        if (cloudBookmarks.length > 0) {
          setBookmarkedIds((prev) => Array.from(new Set([...prev, ...cloudBookmarks])));
        }
        if (Object.keys(cloudProgress).length > 0) {
          setProgressMap((prev) => ({ ...prev, ...cloudProgress }));
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, progressPath);
      }
    );

    return () => unsubscribe();
  }, [isAuthReady, currentUser]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  const updateSettings = (partial: Partial<ReaderSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  const toggleDarkMode = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  const toggleBookmark = (novelId: string) => {
    const targetNovel = novels.find((n) => n.id === novelId);
    setBookmarkedIds((prev) => {
      const isNowBookmarked = !prev.includes(novelId);
      const next = isNowBookmarked ? [...prev, novelId] : prev.filter((id) => id !== novelId);
      try {
        localStorage.setItem(STORAGE_BOOKMARKS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      const currentChap = progressMap[novelId]?.chapterNumber || 1;
      syncUserProgressToFirestore(novelId, currentChap, isNowBookmarked, targetNovel).catch(() => {});
      return next;
    });
  };

  const openReader = (novelId: string, chapterNumber?: number) => {
    const targetNovel = novels.find((n) => n.id === novelId);
    const savedChap = progressMap[novelId]?.chapterNumber || 1;
    const targetChapter = chapterNumber || savedChap;
    setReadingState({ novelId, chapterNumber: targetChapter });

    const updatedProgress: Record<string, ReadingProgress> = {
      ...progressMap,
      [novelId]: {
        novelId,
        chapterId: `${novelId}-c${targetChapter}`,
        chapterNumber: targetChapter,
        scrollPercentage: 0,
        updatedAt: new Date().toISOString()
      }
    };
    setProgressMap(updatedProgress);
    try {
      localStorage.setItem(STORAGE_PROGRESS_KEY, JSON.stringify(updatedProgress));
    } catch {
      // ignore
    }
    syncUserProgressToFirestore(
      novelId,
      targetChapter,
      bookmarkedIds.includes(novelId),
      targetNovel
    ).catch(() => {});
  };

  // Real-time Reading EXP Timer:
  // - Below Lv 20: 5 minutes (300s) -> +100 EXP
  // - Lv 20 to 50: 10 minutes (600s) -> +150 EXP
  // - Lv 51+: 15 minutes (900s) -> +200 EXP
  useEffect(() => {
    if (!readingState) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;

      setReadingSecondsInCycle((prevSec) => {
        const currentLvl = Math.max(1, Math.min(100, userProfile.level || 1));
        if (currentLvl >= 100) return 0;

        const rule = getReadingExpRule(currentLvl);
        const nextSec = prevSec + 1;

        if (nextSec >= rule.requiredSeconds) {
          const remainderSec = nextSec - rule.requiredSeconds;
          try {
            localStorage.setItem(STORAGE_READING_SECONDS_KEY, String(remainderSec));
          } catch {
            // ignore
          }

          // Award EXP & check progressive level up
          setUserProfile((prevProfile) => {
            const initialLvl = Math.max(1, Math.min(100, prevProfile.level || 1));
            let lvl = initialLvl;
            if (lvl >= 100) return prevProfile;

            const activeRule = getReadingExpRule(lvl);
            let exp = (prevProfile.exp || 0) + activeRule.expGain;
            let equippedTitle = prevProfile.equippedTitle;
            let leveledUp = false;

            while (lvl < 100 && exp >= getRequiredExpForLevel(lvl)) {
              const prevTier = getTitleForLevel(lvl);
              exp -= getRequiredExpForLevel(lvl);
              lvl += 1;
              leveledUp = true;
              const nextTier = getTitleForLevel(lvl);
              if (nextTier.name !== prevTier.name) {
                equippedTitle = nextTier.name;
              }
            }

            if (lvl >= 100) {
              exp = getRequiredExpForLevel(100);
            }

            const updated: UserProfileData = {
              ...prevProfile,
              level: lvl,
              exp,
              equippedTitle
            };

            try {
              localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(updated));
            } catch {
              // ignore
            }
            syncUserProfileToFirestore(updated, true).catch(() => {});

            const toastMsg = leveledUp
              ? `Đột phá cấp độ Lv ${lvl}! (+${activeRule.expGain} EXP sau ${activeRule.requiredMinutes} phút đọc)`
              : `+${activeRule.expGain} EXP (Đọc truyện đủ ${activeRule.requiredMinutes} phút · ${exp.toLocaleString('vi-VN')}/${getRequiredExpForLevel(lvl).toLocaleString('vi-VN')} EXP)`;
            setExpGainToast(toastMsg);
            window.setTimeout(() => {
              setExpGainToast((current) => (current === toastMsg ? null : current));
            }, 4500);

            return updated;
          });

          return remainderSec;
        }

        try {
          localStorage.setItem(STORAGE_READING_SECONDS_KEY, String(nextSec));
        } catch {
          // ignore
        }
        return nextSec;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [readingState, userProfile.level]);

  useEffect(() => {
    fetch('/api/novels')
      .then((r) => r.json())
      .then((data) => {
        if (data.novels) setNovels(applyCoverOverrides(data.novels));
      })
      .catch(() => {});

    let reconnectTimer: number | null = null;

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
      };

      socket.onmessage = (msg) => {
        try {
          const event: RealtimeUpdateEvent = JSON.parse(msg.data);

          if (event.type === 'init:state' && event.novels) {
            setNovels(applyCoverOverrides(event.novels));
            if (event.activeReaders) setActiveReaders(event.activeReaders);
          } else if (event.type === 'presence:update' && event.activeReaders) {
            setActiveReaders(event.activeReaders);
          } else if (event.type === 'novel:updated' && event.novel) {
            const updatedNovel = normalizeNovelChapters(event.novel);
            setNovels((prevNovels) =>
              applyCoverOverrides(
                prevNovels.map((n) => (n.id === updatedNovel.id ? { ...n, ...updatedNovel } : n))
              )
            );
          } else if (event.type === 'novel:created' && event.novel) {
            const incomingNovel = normalizeNovelChapters(event.novel);
            setNovels((prevNovels) => {
              if (prevNovels.some((n) => n.id === incomingNovel.id)) return prevNovels;
              return applyCoverOverrides([incomingNovel, ...prevNovels]);
            });

            const firstChap = incomingNovel.chapters[0];
            if (firstChap) {
              setNewChapterAlert({
                novelId: incomingNovel.id,
                novelTitle: incomingNovel.title,
                chapterNumber: firstChap.number,
                title: firstChap.title
              });
            }
          } else if (event.type === 'chapter:published' && event.novelId && event.chapter) {
            const incomingChapter = event.chapter;
            const targetNovelId = event.novelId;

            setNovels((prevNovels) =>
              prevNovels.map((novel) => {
                if (novel.id !== targetNovelId) return novel;
                const alreadyExists = novel.chapters.some(
                  (c) => c.id === incomingChapter.id || c.number === incomingChapter.number
                );
                if (alreadyExists) return novel;
                return normalizeNovelChapters({
                  ...novel,
                  updatedAt: incomingChapter.publishedAt,
                  lastSyncedAt: novel.sourceUrl ? incomingChapter.publishedAt : novel.lastSyncedAt,
                  chapters: [...novel.chapters, incomingChapter]
                });
              })
            );

            setNewChapterAlert({
              novelId: targetNovelId,
              novelTitle: event.novelTitle || 'Tác phẩm',
              chapterNumber: incomingChapter.number,
              title: incomingChapter.title
            });
          }
        } catch {
          // ignore
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        reconnectTimer = window.setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();

    return () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const mergeReturnedNovelAndChapter = (returnedNovel: Novel, returnedChapter?: Novel['chapters'][number]) => {
    setNovels((prevNovels) =>
      applyCoverOverrides(
        prevNovels.map((n) => {
          if (n.id !== returnedNovel.id) return n;
          const combinedChapters = returnedChapter
            ? [...n.chapters, ...(returnedNovel.chapters || []), returnedChapter]
            : [...n.chapters, ...(returnedNovel.chapters || [])];
          return normalizeNovelChapters({
            ...n,
            ...returnedNovel,
            chapters: combinedChapters
          });
        })
      )
    );
  };

  const handlePublishChapter = async (
    novelId: string,
    title?: string,
    content?: string,
    chapterUrl?: string
  ) => {
    const res = await fetch(`/api/novels/${novelId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, chapterUrl })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.novel && data.chapter) {
        mergeReturnedNovelAndChapter(data.novel, data.chapter);
        await syncNovelAndChapterToFirestore(data.novel, data.chapter).catch(() => {});
      }
    }
  };

  const handleQuickAutoRelease = async (novelId?: string) => {
    const res = await fetch('/api/realtime/release-next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.novel && data.chapter) {
        mergeReturnedNovelAndChapter(data.novel, data.chapter);
        await syncNovelAndChapterToFirestore(data.novel, data.chapter).catch(() => {});
      }
    }
  };

  const handleSyncSingleNovelUrl = async (novelId: string): Promise<number | null> => {
    if (syncingNovelId) return null;
    setSyncingNovelId(novelId);
    try {
      const res = await fetch(`/api/novels/${novelId}/sync-url`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.novel && data.chapter) {
          mergeReturnedNovelAndChapter(data.novel, data.chapter);
          await syncNovelAndChapterToFirestore(data.novel, data.chapter).catch(() => {});
          return Number(data.chapter.number) || null;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      setSyncingNovelId(null);
    }
  };

  const handleCreateNovel = async (payload: CreateNovelPayload) => {
    const res = await fetch('/api/novels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.novel) {
        setNovels((prev) => {
          if (prev.some((n) => n.id === data.novel.id)) return prev;
          return [data.novel, ...prev];
        });
        setBookmarkedIds((prev) =>
          prev.includes(data.novel.id) ? prev : [data.novel.id, ...prev]
        );
        await syncNovelAndChapterToFirestore(data.novel, data.novel.chapters?.[0]);
        await syncUserProgressToFirestore(data.novel.id, 1, true, data.novel);
      }
    }
  };

  const handleImportUrlNovel = async (payload: ImportUrlPayload) => {
    const res = await fetch('/api/novels/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.novel) {
        setNovels((prev) => {
          if (prev.some((n) => n.id === data.novel.id)) return prev;
          return [data.novel, ...prev];
        });
        setBookmarkedIds((prev) =>
          prev.includes(data.novel.id) ? prev : [data.novel.id, ...prev]
        );
        await syncNovelAndChapterToFirestore(data.novel, data.novel.chapters?.[0]);
        await syncUserProgressToFirestore(data.novel.id, 1, true, data.novel);
      }
    }
  };

  const handleDeleteNovel = async (novelId: string) => {
    if (!isAdmin) return;
    setNovels((prev) => prev.filter((n) => n.id !== novelId));
    setBookmarkedIds((prev) => {
      const next = prev.filter((id) => id !== novelId);
      try {
        localStorage.setItem(STORAGE_BOOKMARKS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    fetch(`/api/novels/${encodeURIComponent(novelId)}`, { method: 'DELETE' }).catch(() => {});
    await deleteNovelFromFirestore(novelId).catch(() => {});
  };

  const handleUpdateNovelCover = async (
    novelId: string,
    updates: { coverStyle: Novel['coverStyle']; coverImageUrl?: string }
  ) => {
    if (!isAdmin) return;
    try {
      const currentOverrides = loadSavedCoverOverrides();
      currentOverrides[novelId] = {
        coverStyle: updates.coverStyle,
        coverImageUrl: updates.coverImageUrl || ''
      };
      localStorage.setItem(STORAGE_COVERS_KEY, JSON.stringify(currentOverrides));
    } catch {
      // ignore localStorage quota errors
    }

    let updatedTarget: Novel | undefined;
    setNovels((prev) =>
      prev.map((novel) => {
        if (novel.id !== novelId) return novel;
        const nextNovel: Novel = {
          ...novel,
          coverStyle: updates.coverStyle,
          coverImageUrl: updates.coverImageUrl || undefined
        };
        updatedTarget = nextNovel;
        return nextNovel;
      })
    );

    fetch(`/api/novels/${novelId}/cover`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coverStyle: updates.coverStyle,
        coverImageUrl: updates.coverImageUrl || ''
      })
    }).catch(() => {});

    if (updatedTarget) {
      await syncNovelAndChapterToFirestore(updatedTarget).catch(() => {});
    }
  };

  const handleFeaturedGalleryCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    if (!file || !novels[0]) return;
    try {
      const dataUrl = await compressBookCoverFile(file);
      await handleUpdateNovelCover(novels[0].id, {
        coverStyle: novels[0].coverStyle,
        coverImageUrl: dataUrl
      });
    } catch {
      // ignore
    } finally {
      e.target.value = '';
    }
  };

  const formatRelativeTime = (iso: string) => {
    const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (diffSec < 60) return `${diffSec}s trước`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}p trước`;
    const diffHour = Math.floor(diffMin / 60);
    return `${diffHour}h trước`;
  };

  const getHostname = (url?: string) => {
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  const allChaptersSorted = novels
    .flatMap((n) =>
      n.chapters.map((c) => ({
        novel: n,
        chapter: c
      }))
    )
    .sort((a, b) => new Date(b.chapter.publishedAt).getTime() - new Date(a.chapter.publishedAt).getTime());

  if (readingState) {
    const activeNovel = novels.find((n) => n.id === readingState.novelId) || novels[0];
    const activeChapter =
      activeNovel?.chapters.find((c) => c.number === readingState.chapterNumber) ||
      activeNovel?.chapters[activeNovel.chapters.length - 1];

    if (activeNovel && activeChapter) {
      return (
        <>
          <ReaderView
            novel={activeNovel}
            chapter={activeChapter}
            settings={settings}
            onUpdateSettings={updateSettings}
            onSelectChapter={(num) => openReader(activeNovel.id, num)}
            onBackToCatalog={() => setReadingState(null)}
            newChapterAlert={newChapterAlert}
            onDismissNewChapterAlert={() => setNewChapterAlert(null)}
            onFetchNextChapter={() => handleSyncSingleNovelUrl(activeNovel.id)}
            isFetchingNextChapter={syncingNovelId === activeNovel.id}
          />
          {expGainToast && (
            <div className="fixed bottom-20 right-4 z-50 px-4 py-2.5 rounded-xl bg-[#181824]/95 text-white text-xs font-semibold border border-purple-500/40 shadow-2xl flex items-center gap-2 pointer-events-none">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{expGainToast}</span>
            </div>
          )}
        </>
      );
    }
  }

  const dynamicGenres = Array.from(new Set(novels.map((n) => n.genre)));
  const genres = ['Tất cả', ...dynamicGenres];

  const genresToDisplay =
    selectedGenre === 'Tất cả'
      ? dynamicGenres
      : dynamicGenres.filter((g) => g === selectedGenre);

  const featuredNovel = novels[0] || null;
  const latestFeaturedChapter =
    featuredNovel && featuredNovel.chapters.length > 0
      ? featuredNovel.chapters[featuredNovel.chapters.length - 1]
      : null;
  const bookmarkedNovels = novels.filter((n) => bookmarkedIds.includes(n.id));

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] dark:bg-[#0C0A09] text-stone-900 dark:text-stone-100 pb-12">
      {/* Top Bar: Hamburger Menu at start, Brand title, and Right Zone with "URL" button + User Avatar Dropdown */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-5 md:px-10 h-15 border-b border-stone-200/80 dark:border-stone-800/80 bg-[#FBF9F5]/90 dark:bg-[#0C0A09]/90 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="min-h-[40px] min-w-[40px] -ml-2 flex items-center justify-center rounded-lg text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            aria-label="Mở menu điều hướng"
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('discover');
            }}
            className="font-display text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100 whitespace-nowrap shrink-0"
          >
            Mạc Thư Các
          </a>
        </div>

        {/* Right Zone: User Avatar with Liquid Glass Effect (unlocked at Lv 50+) & Dropdown Menu */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0" ref={avatarMenuRef}>
          {/* Top-right Avatar Trigger */}
          <div className="relative flex items-center justify-center">
            {hasLiquidGlass && avatarBurstKey > 0 && (
              <span
                key={`ripple-${avatarBurstKey}`}
                className="liquid-glass-ripple"
                aria-hidden="true"
              />
            )}
            <button
              key={`orb-${avatarBurstKey}`}
              type="button"
              onClick={() => {
                if (hasLiquidGlass) setAvatarBurstKey((k) => k + 1);
                setIsAvatarMenuOpen((prev) => !prev);
              }}
              className={`w-10 h-10 rounded-full p-[2.5px] overflow-hidden focus:outline-none cursor-pointer transition-all duration-300 ${
                hasLiquidGlass
                  ? `liquid-glass-avatar ${
                      avatarBurstKey > 0 ? 'liquid-glass-avatar-active liquid-glass-avatar-burst' : ''
                    }`
                  : 'active:scale-95'
              } ${activeTitleTheme.ringClass} ${activeTitleTheme.glowClass}`}
              aria-label="Mở menu tài khoản"
              title={`${userProfile.nickname} · ${activeTitleTheme.name}${hasLiquidGlass ? ' · Liquid Glass' : ''}`}
            >
              <div className="relative w-full h-full rounded-full overflow-hidden bg-stone-900">
                <img
                  src={userProfile.avatarUrl}
                  alt={userProfile.nickname}
                  className="w-full h-full rounded-full object-cover"
                />
                {hasLiquidGlass && <span className="liquid-glass-lens" aria-hidden="true" />}
              </div>
            </button>

            {/* Dropdown Menu (Liquid Glass Refraction at Lv 50+) + Google Sign In / Sign Up */}
            {isAvatarMenuOpen && (
              <div
                className={`absolute right-0 top-full mt-3 w-72 sm:w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl text-stone-100 overflow-hidden z-50 select-none ${
                  hasLiquidGlass
                    ? 'liquid-glass-popover'
                    : 'bg-[#191924] border border-white/10 shadow-2xl'
                }`}
              >
                {/* User Header Info */}
                <div className="p-4 sm:p-5 flex items-center gap-3.5 border-b border-white/15 bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasLiquidGlass) setAvatarBurstKey((k) => k + 1);
                      setIsAvatarMenuOpen(false);
                      setActiveProfileSection('profile');
                    }}
                    className={`relative w-13 h-13 sm:w-14 sm:h-14 rounded-full p-[3px] shrink-0 overflow-hidden cursor-pointer ${
                      hasLiquidGlass
                        ? 'liquid-glass-avatar liquid-glass-avatar-burst'
                        : 'transition-transform active:scale-95'
                    } ${activeTitleTheme.ringClass} ${activeTitleTheme.glowClass}`}
                    title="Nhấn để chỉnh sửa Hồ sơ & Avatar"
                  >
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-[#191924]">
                      <img
                        src={userProfile.avatarUrl}
                        alt={userProfile.nickname}
                        className="w-full h-full rounded-full object-cover"
                      />
                      {hasLiquidGlass && <span className="liquid-glass-lens" aria-hidden="true" />}
                    </div>
                  </button>
                  <div className="min-w-0 flex-1 overflow-hidden space-y-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm sm:text-base font-bold text-white truncate">
                        {userProfile.nickname}
                      </p>
                      {isAdmin && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/50 text-[10px] font-extrabold text-amber-300 uppercase shrink-0">
                          <Crown className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                          Admin
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-300 flex items-center gap-1.5 min-w-0">
                      <span className="font-mono-num text-stone-200 font-semibold shrink-0">
                        Lv {userProfile.level}
                      </span>
                      <span className="shrink-0">·</span>
                      <span className={`font-semibold truncate min-w-0 ${activeTitleTheme.textClass}`}>
                        {activeTitleTheme.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-stone-400 font-mono-num truncate">
                      {userProfile.level >= 100
                        ? 'MAX EXP (95.000 EXP)'
                        : `EXP: ${(userProfile.exp || 0).toLocaleString('vi-VN')} / ${getRequiredExpForLevel(userProfile.level).toLocaleString('vi-VN')}`}
                    </div>
                  </div>
                </div>

                {/* Menu Action Items */}
                <div className="py-2 px-2 space-y-0.5">
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAvatarMenuOpen(false);
                        setActiveProfileSection('admin');
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-2 text-sm font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 transition-all cursor-pointer mb-1 liquid-glass-menu-item"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Crown className="w-5 h-5 text-amber-400 shrink-0" />
                        <span className="truncate">Quản trị Admin</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 shrink-0">
                        VIP
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setActiveProfileSection('account');
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:text-white cursor-pointer liquid-glass-menu-item"
                  >
                    <UserCircle className="w-5 h-5 text-stone-300 shrink-0" />
                    <span>Tài khoản của tôi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setActiveProfileSection('profile');
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:text-white cursor-pointer liquid-glass-menu-item"
                  >
                    <UserIcon className="w-5 h-5 text-stone-300 shrink-0" />
                    <span>Hồ sơ của tôi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setActiveProfileSection('settings');
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:text-white cursor-pointer liquid-glass-menu-item"
                  >
                    <Settings className="w-5 h-5 text-stone-300 shrink-0" />
                    <span>Cài đặt tài khoản</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setActiveTab('library');
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm font-medium text-stone-100 hover:text-white cursor-pointer liquid-glass-menu-item"
                  >
                    <div className="flex items-center gap-3.5">
                      <Bookmark className="w-5 h-5 text-stone-300 shrink-0" />
                      <span>Theo dõi</span>
                    </div>
                    <span className="text-xs font-mono-num px-2 py-0.5 rounded-md bg-white/10 text-stone-200 border border-white/10">
                      {bookmarkedNovels.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setActiveProfileSection('title');
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:text-white cursor-pointer liquid-glass-menu-item"
                  >
                    <Star className="w-5 h-5 text-stone-300 shrink-0" />
                    <span>Danh hiệu</span>
                  </button>
                </div>

                {/* Bottom Divider + Login / Register (or Red Logout when signed in) */}
                <div className="p-2.5 border-t border-white/15 bg-white/[0.02]">
                  {currentUser ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsAvatarMenuOpen(false);
                        signOutUser();
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-semibold text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer liquid-glass-menu-item"
                    >
                      <LogOut className="w-5 h-5 shrink-0" />
                      <span>Đăng xuất</span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAvatarMenuOpen(false);
                          setAuthModalMode('login');
                        }}
                        className="py-2 px-3 rounded-xl bg-white/90 text-stone-950 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-white transition-all shadow-sm cursor-pointer active:scale-95"
                      >
                        <LogIn className="w-3.5 h-3.5 shrink-0" />
                        <span>Đăng nhập</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAvatarMenuOpen(false);
                          setAuthModalMode('register');
                        }}
                        className="py-2 px-3 rounded-xl bg-purple-600/90 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-purple-500 border border-white/20 transition-all shadow-sm cursor-pointer active:scale-95"
                      >
                        <UserPlus className="w-3.5 h-3.5 shrink-0" />
                        <span>Đăng ký</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Left Slide-out Hamburger Menu Drawer */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMenuOpen(false)}
          />

          <aside className="relative z-10 w-72 max-w-[82vw] h-full bg-[#FBF9F5] dark:bg-stone-900 border-r border-stone-200 dark:border-stone-800 shadow-2xl flex flex-col justify-between p-5">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
                <span className="font-display text-xl font-bold text-stone-900 dark:text-stone-100">
                  Mạc Thư Các
                </span>
                <button
                  type="button"
                  onClick={() => setIsMenuOpen(false)}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer"
                  aria-label="Đóng menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('discover');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center gap-3 text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === 'discover'
                      ? 'bg-amber-900/10 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300 font-semibold'
                      : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800'
                  }`}
                >
                  <BookOpen className="w-4 h-4 shrink-0" />
                  <span>Khám phá kho truyện</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsLogOpen(true);
                  }}
                  className="w-full min-h-[44px] px-3.5 rounded-xl flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <History className="w-4 h-4 shrink-0 text-amber-800 dark:text-amber-400" />
                    <span>Nhật kí chương vừa lên sóng</span>
                  </div>
                  <span className="font-mono-num text-[11px] opacity-75">
                    {allChaptersSorted.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('library');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center justify-between text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === 'library'
                      ? 'bg-amber-900/10 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300 font-semibold'
                      : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Bookmark className="w-4 h-4 shrink-0" />
                    <span>Tủ sách đã lưu</span>
                  </div>
                  <span className="font-mono-num text-[11px] opacity-75">
                    {bookmarkedNovels.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className="w-full min-h-[44px] px-3.5 rounded-xl flex items-center justify-between text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    {settings.theme === 'dark' ? (
                      <Sun className="w-4 h-4 shrink-0 text-amber-400" />
                    ) : (
                      <Moon className="w-4 h-4 shrink-0" />
                    )}
                    <span>Chế độ hiển thị</span>
                  </div>
                  <span className="text-[11px] text-stone-500 dark:text-stone-400">
                    {settings.theme === 'dark' ? 'Nền tối' : 'Nền sáng'}
                  </span>
                </button>
              </nav>
            </div>

            <div className="pt-4 border-t border-stone-200 dark:border-stone-800 space-y-2 text-[11px] text-stone-500 dark:text-stone-400">
              <div className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    wsConnected ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-amber-500'
                  }`}
                />
                <span>{wsConnected ? `Trực tuyến · ${activeReaders} độc giả` : 'Đang kết nối...'}</span>
              </div>
              <p>Tự động cuộn · Giọng đọc · Nhập từ URL</p>
            </div>
          </aside>
        </div>
      )}

      {/* "Nhật kí" Drawer / Modal containing Chương Vừa Lên Sóng */}
      {isLogOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => setIsLogOpen(false)}
          />

          <aside className="relative z-10 w-full max-w-md h-full bg-[#FBF9F5] dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl flex flex-col justify-between">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold text-stone-900 dark:text-stone-100">
                  Nhật Kí Chương Vừa Lên Sóng
                </h2>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  Cập nhật tự động theo thời gian thực qua WebSocket
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsLogOpen(false)}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-white transition-colors cursor-pointer"
                aria-label="Đóng nhật kí"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-2.5 bg-stone-200/40 dark:bg-stone-950/60 border-b border-stone-200/70 dark:border-stone-800 flex items-center justify-between text-xs">
              <span className="text-stone-500 dark:text-stone-400 font-mono-num">
                Tổng cộng: {allChaptersSorted.length} chương
              </span>
              <button
                type="button"
                onClick={() => handleQuickAutoRelease()}
                className="font-medium text-amber-800 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Lấy chương mới ngay</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-stone-200/60 dark:divide-stone-800/80 px-4 py-2">
              {allChaptersSorted.map(({ novel, chapter }) => (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => {
                    setIsLogOpen(false);
                    openReader(novel.id, chapter.number);
                  }}
                  className="w-full py-3.5 px-2 text-left flex items-start justify-between gap-3 rounded-xl hover:bg-stone-200/50 dark:hover:bg-stone-800/50 transition-colors group cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                      <span className="font-semibold text-stone-800 dark:text-stone-200 truncate">
                        {novel.title}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{novel.genre}</span>
                      {novel.sourceUrl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-800 dark:text-amber-400">
                            {getHostname(novel.sourceUrl)}
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-sm font-medium text-stone-900 dark:text-stone-100 group-hover:text-amber-800 dark:group-hover:text-amber-400 mt-1 truncate transition-colors">
                      Chương {chapter.number}: {chapter.title}
                    </p>
                  </div>

                  <div className="flex flex-col items-end shrink-0 text-[11px] font-mono-num text-stone-400 dark:text-stone-500">
                    <span>{formatRelativeTime(chapter.publishedAt)}</span>
                    <span className="mt-1">{chapter.wordCount} chữ</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      {/* Compact Real-time Sync Bar beneath Mạc Thư Các */}
      {newChapterAlert && (
        <div className="max-w-6xl w-full mx-auto px-5 md:px-10 pt-2">
          <div className="inline-flex max-w-full items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-amber-900/10 dark:bg-amber-500/10 border border-amber-800/20 dark:border-amber-500/20 text-[11px] leading-tight overflow-hidden">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
              <Sparkles className="w-3 h-3 text-amber-800 dark:text-amber-400 shrink-0" />
              <span className="font-semibold text-stone-900 dark:text-stone-100 shrink-0">
                Đồng bộ thời gian thực:
              </span>
              <span className="text-stone-700 dark:text-stone-300 truncate min-w-0">
                {newChapterAlert.novelTitle} · C.{newChapterAlert.chapterNumber}: {newChapterAlert.title}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  openReader(newChapterAlert.novelId, newChapterAlert.chapterNumber);
                  setNewChapterAlert(null);
                }}
                className="px-2 py-0.5 rounded bg-amber-800 dark:bg-amber-600 text-white text-[10px] font-semibold hover:bg-amber-900 transition-colors cursor-pointer whitespace-nowrap"
              >
                Đọc ngay
              </button>
              <button
                type="button"
                onClick={() => setNewChapterAlert(null)}
                className="p-0.5 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors cursor-pointer"
                aria-label="Đóng thông báo đồng bộ"
                title="Đóng"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-5 md:px-10 pt-6 md:pt-8 space-y-10">
        {/* TAB 1: DISCOVER */}
        {activeTab === 'discover' && (
          !featuredNovel ? (
            <section className="py-16 px-6 rounded-2xl border border-stone-200/80 dark:border-stone-800/80 bg-white/60 dark:bg-stone-900/40 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-900/10 dark:bg-amber-500/15 flex items-center justify-center text-amber-800 dark:text-amber-400">
                <BookOpen className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100">
                  Kho truyện hiện đang trống
                </h1>
                <p className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 leading-relaxed">
                  Toàn bộ truyện mẫu đã được xoá. Hãy nhập truyện mới từ URL hoặc tự đăng tác phẩm gốc của bạn.
                </p>
              </div>
              <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalState({ isOpen: true, mode: 'url' })}
                  className="min-h-[38px] px-4 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Nhập truyện từ URL</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalState({ isOpen: true, mode: 'novel' })}
                  className="min-h-[38px] px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-800 text-stone-800 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Tự đăng truyện mới</span>
                </button>
              </div>
            </section>
          ) : (
          <>
            {/* Focused Featured Novel Banner */}
            <section className="pb-8 border-b border-stone-200/80 dark:border-stone-800/80">
              <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">
                <div
                  onClick={() => openReader(featuredNovel.id)}
                  className="w-36 sm:w-44 shrink-0 group text-left cursor-pointer mx-auto sm:mx-0"
                >
                  <BookCoverArtwork
                    styleType={featuredNovel.coverStyle}
                    coverImageUrl={featuredNovel.coverImageUrl}
                    title={featuredNovel.title}
                    author={featuredNovel.author}
                    genre={featuredNovel.genre}
                    onUploadCoverImage={
                      isAdmin
                        ? (dataUrl) =>
                            handleUpdateNovelCover(featuredNovel.id, {
                              coverStyle: featuredNovel.coverStyle,
                              coverImageUrl: dataUrl
                            })
                        : undefined
                    }
                    onOpenCoverEditor={
                      isAdmin ? () => setEditingCoverNovelId(featuredNovel.id) : undefined
                    }
                    className="w-full aspect-[3/4] rounded-xl"
                  />
                </div>

                <div className="flex-1 min-w-0 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                    <span className="font-medium text-amber-800 dark:text-amber-400">
                      {featuredNovel.sourceUrl ? `Đồng bộ từ ${getHostname(featuredNovel.sourceUrl)}` : 'Truyện tâm điểm'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{featuredNovel.genre}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">{featuredNovel.chapters.length} chương</span>
                  </div>

                  <h1 className="font-display text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 leading-tight text-balance">
                    {featuredNovel.title}
                  </h1>

                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Tác giả: <span className="text-stone-800 dark:text-stone-200 font-medium">{featuredNovel.author}</span>
                  </p>

                  <p className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed max-w-3xl line-clamp-2">
                    {featuredNovel.synopsis}
                  </p>

                  <div className="pt-2 flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => openReader(featuredNovel.id, 1)}
                      className="min-h-[38px] px-4 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-medium flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Đọc Tự Động</span>
                    </button>

                    {latestFeaturedChapter && (
                      <button
                        type="button"
                        onClick={() => openReader(featuredNovel.id, latestFeaturedChapter.number)}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200/50 dark:hover:bg-stone-800/60 transition-colors cursor-pointer truncate max-w-[220px]"
                      >
                        Mới: Chương {latestFeaturedChapter.number}
                      </button>
                    )}

                    {isAdmin && (
                      <>
                        <input
                          ref={featuredCoverInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleFeaturedGalleryCoverChange}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => featuredCoverInputRef.current?.click()}
                          className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-amber-800/10 hover:bg-amber-800/20 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 border border-amber-700/30 dark:border-amber-400/30 text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ImagePlus className="w-3.5 h-3.5 shrink-0" />
                          <span>Lấy ảnh từ thư viện làm giao diện sách</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setEditingCoverNovelId(featuredNovel.id)}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200/50 dark:hover:bg-stone-800/60 flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Palette className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                          <span>Chỉnh bìa sách</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Filter & Search Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-1 p-1 bg-stone-200/60 dark:bg-stone-900 rounded-xl overflow-x-auto">
                {genres.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => setSelectedGenre(genre)}
                    className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedGenre === genre
                        ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white shadow-2xs'
                        : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                    }`}
                  >
                    {genre}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm truyện, tác giả..."
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-white/80 dark:bg-stone-900 border border-stone-200/90 dark:border-stone-800 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
                />
              </div>
            </div>

            {/* Each Genre has 1 Horizontal Row of Novels */}
            <div className="space-y-10">
              {genresToDisplay.map((genreName) => {
                const genreNovels = novels.filter((novel) => {
                  const matchesGenre = novel.genre === genreName;
                  const matchesSearch =
                    !searchQuery.trim() ||
                    novel.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    novel.author.toLowerCase().includes(searchQuery.toLowerCase());
                  return matchesGenre && matchesSearch;
                });

                if (genreNovels.length === 0) return null;

                return (
                  <section
                    key={genreName}
                    className="space-y-4 pb-8 border-b border-stone-200/70 dark:border-stone-800/80 last:border-b-0"
                  >
                    {/* Genre Row Header with Horizontal Scroll Controls */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-baseline gap-2.5">
                        <h2 className="font-display text-2xl font-bold text-stone-900 dark:text-stone-100">
                          {genreName}
                        </h2>
                        <span className="text-xs font-mono-num text-stone-400 dark:text-stone-500">
                          {genreNovels.length} truyện
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => scrollGenreRow(genreName, 'left')}
                          className="w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-800 flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                          aria-label={`Trượt trái hàng ${genreName}`}
                          title="Trượt sang trái"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => scrollGenreRow(genreName, 'right')}
                          className="w-7 h-7 rounded-lg border border-stone-200 dark:border-stone-800 flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/50 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                          aria-label={`Trượt phải hàng ${genreName}`}
                          title="Trượt sang phải"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Horizontal Scroll Row of Novels */}
                    <div
                      ref={(el) => {
                        genreRowRefs.current[genreName] = el;
                      }}
                      className="flex items-stretch gap-5 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth"
                    >
                      {genreNovels.map((novel) => {
                        const latestChap = novel.chapters[novel.chapters.length - 1];
                        const savedProgress = progressMap[novel.id];
                        const isBookmarked = bookmarkedIds.includes(novel.id);

                        return (
                          <div
                            key={novel.id}
                            className="snap-start shrink-0 w-76 sm:w-84 flex gap-4 p-3.5 rounded-2xl border border-stone-200/80 dark:border-stone-800/90 bg-white/60 dark:bg-stone-900/45 hover:border-stone-300 dark:hover:border-stone-700 transition-colors group"
                          >
                            <div
                              onClick={() => openReader(novel.id)}
                              className="w-22 sm:w-26 shrink-0 text-left cursor-pointer"
                            >
                              <BookCoverArtwork
                                styleType={novel.coverStyle}
                                coverImageUrl={novel.coverImageUrl}
                                title={novel.title}
                                author={novel.author}
                                compact
                                onUploadCoverImage={
                                  isAdmin
                                    ? (dataUrl) =>
                                        handleUpdateNovelCover(novel.id, {
                                          coverStyle: novel.coverStyle,
                                          coverImageUrl: dataUrl
                                        })
                                    : undefined
                                }
                                onOpenCoverEditor={
                                  isAdmin ? () => setEditingCoverNovelId(novel.id) : undefined
                                }
                                className="w-full aspect-[3/4] rounded-lg"
                              />
                            </div>

                            <div className="flex-1 min-w-0 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[11px] font-mono-num text-stone-500 dark:text-stone-400 truncate">
                                    {novel.chapters.length} chương
                                    {novel.sourceUrl ? ` · ${getHostname(novel.sourceUrl)}` : ''}
                                  </span>

                                  <button
                                    type="button"
                                    onClick={() => toggleBookmark(novel.id)}
                                    className={`p-1 rounded-md transition-colors cursor-pointer shrink-0 ${
                                      isBookmarked
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
                                    }`}
                                    title={isBookmarked ? 'Bỏ lưu' : 'Lưu vào tủ sách'}
                                    aria-label="Lưu vào tủ sách"
                                  >
                                    <Bookmark className="w-3.5 h-3.5" fill={isBookmarked ? 'currentColor' : 'none'} />
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => openReader(novel.id)}
                                  className="text-left block mt-0.5 cursor-pointer w-full"
                                >
                                  <h3 className="font-display text-lg font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-800 dark:group-hover:text-amber-400 transition-colors truncate">
                                    {novel.title}
                                  </h3>
                                </button>

                                <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                                  {novel.author}
                                </p>

                                <p className="text-xs text-stone-600 dark:text-stone-300 mt-1.5 line-clamp-2 leading-relaxed">
                                  {novel.synopsis}
                                </p>
                              </div>

                              <div className="mt-3 pt-2 border-t border-stone-200/60 dark:border-stone-800/70 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => openReader(novel.id, latestChap.number)}
                                  className="text-[11px] text-stone-500 dark:text-stone-400 hover:text-amber-800 dark:hover:text-amber-400 truncate cursor-pointer"
                                >
                                  C.{latestChap.number} · {formatRelativeTime(latestChap.publishedAt)}
                                </button>

                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    disabled={syncingNovelId === novel.id}
                                    onClick={() => handleSyncSingleNovelUrl(novel.id)}
                                    className="p-1.5 rounded-md border border-stone-300 dark:border-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 cursor-pointer"
                                    title={novel.sourceUrl ? 'Quét chương mới từ URL nguồn' : 'Lấy chương mới tiếp theo'}
                                  >
                                    <RefreshCw className={`w-3 h-3 ${syncingNovelId === novel.id ? 'animate-spin' : ''}`} />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => openReader(novel.id)}
                                    className="px-2.5 py-1 rounded-md bg-stone-200/80 hover:bg-stone-300/80 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-900 dark:text-stone-100 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    {savedProgress ? `Đọc C.${savedProgress.chapterNumber}` : 'Đọc ngay'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
          )
        )}

        {/* TAB 2: UPDATES FEED */}
        {activeTab === 'updates' && (
          <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 dark:border-stone-800 pb-4">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100">
                  Chương Mới Cập Nhật
                </h1>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  Tự động đồng bộ từ nguồn Web/RSS và nhận chương mới qua WebSocket theo thời gian thực
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={Boolean(syncingNovelId)}
                  onClick={async () => {
                    const target = novels.find((n) => n.sourceUrl) || novels[0];
                    if (target) {
                      await handleSyncSingleNovelUrl(target.id);
                    }
                  }}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingNovelId ? 'animate-spin' : ''}`} />
                  <span>{syncingNovelId ? 'Đang lấy chương...' : 'Kiểm tra & Lấy chương mới'}</span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-stone-200/70 dark:divide-stone-800/80">
              {allChaptersSorted.map(({ novel, chapter }) => (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => openReader(novel.id, chapter.number)}
                  className="w-full py-3.5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-stone-200/30 dark:hover:bg-stone-900/50 px-3 -mx-3 rounded-xl transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                      <span className="font-medium text-stone-800 dark:text-stone-200">{novel.title}</span>
                      <span aria-hidden="true">·</span>
                      <span>{novel.genre}</span>
                      {novel.sourceUrl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-800 dark:text-amber-400">
                            Nguồn: {getHostname(novel.sourceUrl)}
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-sm font-medium text-stone-900 dark:text-stone-100 mt-0.5 truncate">
                      Chương {chapter.number}: {chapter.title}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-stone-400 shrink-0">
                    <span className="font-mono-num">{chapter.wordCount} chữ</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(chapter.publishedAt)}
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* TAB 3: LIBRARY (THEO DÕI) */}
        {activeTab === 'library' && (
          <section className="space-y-6">
            <div className="border-b border-stone-200 dark:border-stone-800 pb-4">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100">
                Truyện Đang Theo Dõi
              </h1>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Theo dõi tiến độ đọc tự động và nguồn đồng bộ URL của bạn
              </p>
            </div>

            {bookmarkedNovels.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <p className="text-sm text-stone-500">Chưa có truyện nào trong danh sách theo dõi.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('discover')}
                  className="px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium cursor-pointer"
                >
                  Khám phá truyện
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {bookmarkedNovels.map((novel) => {
                    const latestChap = novel.chapters[novel.chapters.length - 1];
                    const progress = progressMap[novel.id];
                    return (
                      <div
                        key={novel.id}
                        className="flex items-center justify-between gap-4 pb-5 border-b border-stone-200/70 dark:border-stone-800/80"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div
                            onClick={() => {
                              if (isAdmin) setEditingCoverNovelId(novel.id);
                              else openReader(novel.id, progress?.chapterNumber || 1);
                            }}
                            className="w-16 aspect-[3/4] shrink-0 cursor-pointer group"
                          >
                            <BookCoverArtwork
                              styleType={novel.coverStyle}
                              coverImageUrl={novel.coverImageUrl}
                              title={novel.title}
                              author={novel.author}
                              compact
                              onUploadCoverImage={
                                isAdmin
                                  ? (dataUrl) =>
                                      handleUpdateNovelCover(novel.id, {
                                        coverStyle: novel.coverStyle,
                                        coverImageUrl: dataUrl
                                      })
                                  : undefined
                              }
                              className="w-full h-full rounded-md"
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-display text-lg font-bold text-stone-900 dark:text-stone-100 truncate">
                              {novel.title}
                            </h3>
                            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                              Đang đọc: Chương {progress?.chapterNumber || 1} / {novel.chapters.length}
                            </p>
                            <p className="text-[11px] text-amber-800 dark:text-amber-400 mt-0.5 truncate">
                              Mới nhất: Chương {latestChap.number} ({formatRelativeTime(latestChap.publishedAt)})
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setEditingCoverNovelId(novel.id)}
                              className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200/50 dark:hover:bg-stone-800 flex items-center gap-1 cursor-pointer"
                              title="Chỉnh bìa sách & Lấy ảnh từ thư viện"
                            >
                              <Palette className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                              <span className="hidden sm:inline">Chỉnh bìa</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={syncingNovelId === novel.id}
                            onClick={() => handleSyncSingleNovelUrl(novel.id)}
                            className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium flex items-center gap-1 cursor-pointer hover:bg-stone-200/50 dark:hover:bg-stone-800"
                            title={novel.sourceUrl ? 'Lấy chương mới từ URL' : 'Lấy chương mới tiếp theo'}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${syncingNovelId === novel.id ? 'animate-spin' : ''}`} />
                            <span className="hidden sm:inline">Chương mới</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openReader(novel.id, progress?.chapterNumber || 1)}
                            className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-medium shrink-0 cursor-pointer"
                          >
                            Đọc tiếp
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}
      </main>

      <PublishChapterModal
        isOpen={modalState.isOpen}
        initialMode={modalState.mode}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        novels={novels}
        onPublish={handlePublishChapter}
        onQuickAutoRelease={handleQuickAutoRelease}
        onCreateNovel={handleCreateNovel}
        onImportUrlNovel={handleImportUrlNovel}
      />

      <UserProfileModal
        activeSection={activeProfileSection}
        onClose={() => setActiveProfileSection(null)}
        onSwitchSection={(section) => setActiveProfileSection(section)}
        profile={userProfile}
        onUpdateProfile={updateUserProfile}
        settings={settings}
        onUpdateSettings={updateSettings}
        currentUser={currentUser}
        isAdmin={isAdmin}
        onSignInGoogle={() => {
          setActiveProfileSection(null);
          setAuthModalMode('login');
        }}
        bookmarkedCount={bookmarkedNovels.length}
        readNovelsCount={novels.filter((n) => Boolean(progressMap[n.id])).length}
        novels={novels}
        onOpenPublishModal={(mode) => setModalState({ isOpen: true, mode })}
        onTriggerLiveBroadcast={() => handleQuickAutoRelease()}
        onDeleteNovel={handleDeleteNovel}
        readingSecondsInCycle={readingSecondsInCycle}
      />

      {isAdmin && (
        <BookCoverEditorModal
          novel={novels.find((n) => n.id === editingCoverNovelId) || null}
          onClose={() => setEditingCoverNovelId(null)}
          onSaveCover={handleUpdateNovelCover}
        />
      )}

      <AuthGoogleModal
        mode={authModalMode}
        onClose={() => setAuthModalMode(null)}
        onSwitchMode={(m) => setAuthModalMode(m)}
        onAuthenticateGoogle={handleAuthenticateGoogle}
      />
    </div>
  );
}
