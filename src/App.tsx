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
  Palette,
  GitBranch,
  PlusCircle,
  Trash2
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
import { Novel, Chapter, RealtimeUpdateEvent, ReaderSettings, ReadingProgress } from './types';
import { INITIAL_NOVELS, SAMPLE_NOVEL_IDS, isPriorityFeaturedNovel } from './data/seedNovels';
import {
  BookCoverArtwork,
  BookCoverEditorModal,
  compressBookCoverFile
} from './components/BookCoverArtwork';
import { ReaderView } from './components/ReaderView';
import {
  PublishChapterModal,
  CreateNovelPayload,
  ImportUrlPayload,
  PublishModalMode
} from './components/PublishChapterModal';
import {
  UserProfileModal,
  ProfileSectionType,
  UserProfileData,
  PRESET_AVATARS,
  AVAILABLE_TITLES,
  getTitleTheme,
  getTitleForLevel,
  getRequiredExpForLevel,
  getReadingExpRule
} from './components/UserProfileModal';
import { AuthGoogleModal, AuthModalMode } from './components/AuthGoogleModal';
import {
  GitHubSyncConfig,
  GitHubPushResult,
  loadLocalGitHubConfig,
  syncNovelsToGitHub,
  fetchLatestSyncedNovelsFromGitHub,
  loadCachedNovelsFromStorage,
  saveCachedNovelsToStorage,
  mergeNovelsLists,
  extractUrlClientSide,
  buildNovelFromClientExtraction
} from './utils/githubSyncClient';

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
      coverImageUrl:
        typeof ov.coverImageUrl === 'string' && ov.coverImageUrl.trim().length > 0
          ? ov.coverImageUrl.trim()
          : novel.coverImageUrl
    };
  });
}

export default function App() {
  const [novels, setNovels] = useState<Novel[]>(() => {
    const cached = loadCachedNovelsFromStorage();
    return applyCoverOverrides(mergeNovelsLists(INITIAL_NOVELS, cached));
  });
  const [editingCoverNovelId, setEditingCoverNovelId] = useState<string | null>(null);
  const featuredCoverInputRef = useRef<HTMLInputElement | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [activeReaders, setActiveReaders] = useState<number>(1);
  const [syncingNovelId, setSyncingNovelId] = useState<string | null>(null);
  const [githubSyncToast, setGithubSyncToast] = useState<string | null>(null);

  // Firebase Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>(null);

  // Top-right Avatar Dropdown & Profile Modal state
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState<boolean>(false);
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
  const [levelUpNotice, setLevelUpNotice] = useState<{
    level: number;
    titleName: string;
    rarity: string;
  } | null>(null);
  const levelUpTimerRef = useRef<number | null>(null);

  const triggerLevelUpNotice = (newLevel: number, customTitle?: string) => {
    const theme = getTitleTheme(customTitle, newLevel);
    setLevelUpNotice({
      level: newLevel,
      titleName: theme.name,
      rarity: theme.rarity
    });
    if (levelUpTimerRef.current) {
      window.clearTimeout(levelUpTimerRef.current);
    }
    levelUpTimerRef.current = window.setTimeout(() => {
      setLevelUpNotice(null);
      levelUpTimerRef.current = null;
    }, 5000);
  };

  // Navigation & Drawer state
  const [activeTab, setActiveTab] = useState<'discover' | 'updates' | 'library' | 'history'>('discover');
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isLogOpen, setIsLogOpen] = useState<boolean>(false);
  const [selectedGenre, setSelectedGenre] = useState<string>('Tất cả');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [readingState, setReadingState] = useState<{ novelId: string; chapterNumber: number } | null>(null);
  const [openingBookAnim, setOpeningBookAnim] = useState<{
    novel: Novel;
    chapterNumber: number;
  } | null>(null);
  const openingBookTimerRef = useRef<number | null>(null);
  const [modalState, setModalState] = useState<{ isOpen: boolean; mode: PublishModalMode }>({
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
          ttsVoiceId:
            parsed.ttsVoiceId === 'ngoc-huyen-ha-noi' || parsed.ttsVoiceId === 'hoai-my-neural'
              ? parsed.ttsVoiceId
              : 'quynh-anh-4-0'
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
      if (typeof partial.level === 'number' && partial.level > (prev.level || 1)) {
        triggerLevelUpNotice(partial.level, next.equippedTitle);
      }
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
    const targetNovel = novels.find((n) => n.id === novelId) || novels[0];
    const savedChap = progressMap[novelId]?.chapterNumber || 1;
    const targetChapter = chapterNumber || savedChap;

    if (!readingState && targetNovel) {
      if (openingBookTimerRef.current) {
        window.clearTimeout(openingBookTimerRef.current);
      }
      setOpeningBookAnim({ novel: targetNovel, chapterNumber: targetChapter });
      openingBookTimerRef.current = window.setTimeout(() => {
        setOpeningBookAnim(null);
        openingBookTimerRef.current = null;
      }, 720);
    }

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

  const handleRemoveFromHistory = (novelId: string) => {
    setProgressMap((prev) => {
      const next = { ...prev };
      delete next[novelId];
      try {
        localStorage.setItem(STORAGE_PROGRESS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleClearReadingHistory = () => {
    setProgressMap({});
    try {
      localStorage.removeItem(STORAGE_PROGRESS_KEY);
    } catch {
      // ignore
    }
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

            if (leveledUp) {
              triggerLevelUpNotice(lvl, equippedTitle);
            }

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
    saveCachedNovelsToStorage(novels);
  }, [novels]);

  useEffect(() => {
    // Ensure INITIAL_NOVELS from data/ and novels/ is always merged into state on mount
    if (INITIAL_NOVELS.length > 0) {
      setNovels((prev) => applyCoverOverrides(mergeNovelsLists(INITIAL_NOVELS, prev)));
    }

    fetch('/api/novels')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.novels) && data.novels.length > 0) {
          setNovels((prev) =>
            applyCoverOverrides(
              mergeNovelsLists(mergeNovelsLists(INITIAL_NOVELS, data.novels), prev)
            )
          );
        }
      })
      .catch(() => {});

    // Also pull latest synced novels from GitHub raw catalog if repo is configured
    fetchLatestSyncedNovelsFromGitHub()
      .then((ghNovels) => {
        if (ghNovels && ghNovels.length > 0) {
          setNovels((prev) =>
            applyCoverOverrides(
              mergeNovelsLists(mergeNovelsLists(INITIAL_NOVELS, ghNovels), prev)
            )
          );
        }
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
            setNovels((prev) =>
              applyCoverOverrides(
                mergeNovelsLists(mergeNovelsLists(INITIAL_NOVELS, event.novels || []), prev)
              )
            );
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

  const showGitHubToast = (message: string) => {
    setGithubSyncToast(message);
    window.setTimeout(() => {
      setGithubSyncToast((curr) => (curr === message ? null : curr));
    }, 4500);
  };

  const triggerAutoGitHubPush = async (nextNovels: Novel[], commitMessage: string) => {
    const cfg = loadLocalGitHubConfig();
    if (!cfg.autoPush) return;
    const res = await syncNovelsToGitHub(nextNovels, commitMessage);
    if (res.success) {
      showGitHubToast(
        `Đã tự động đồng bộ lên GitHub (${res.commitSha ? res.commitSha.slice(0, 7) : 'data/ & novels/'})`
      );
    }
  };

  const handlePushToGitHub = async (
    configOverride?: Partial<GitHubSyncConfig>,
    commitMessage?: string
  ): Promise<GitHubPushResult> => {
    const res = await syncNovelsToGitHub(novels, commitMessage, configOverride);
    if (res.success) {
      showGitHubToast(
        `Đã đẩy ${novels.length} truyện lên GitHub (${res.commitSha?.slice(0, 7) || 'thành công'})!`
      );
    }
    return res;
  };

  const handlePullFromGitHub = async (configOverride?: Partial<GitHubSyncConfig>): Promise<number> => {
    const mergedCfg = { ...loadLocalGitHubConfig(), ...configOverride };
    const ghNovels = await fetchLatestSyncedNovelsFromGitHub(mergedCfg);
    if (ghNovels && ghNovels.length > 0) {
      setNovels((prev) => {
        const merged = applyCoverOverrides(mergeNovelsLists(ghNovels, prev));
        saveCachedNovelsToStorage(merged);
        return merged;
      });
      showGitHubToast(`Đã nạp ${ghNovels.length} truyện từ GitHub!`);
      return ghNovels.length;
    }
    return 0;
  };

  const mergeReturnedNovelAndChapter = (
    returnedNovel: Novel,
    returnedChapter?: Novel['chapters'][number],
    commitNote?: string
  ) => {
    setNovels((prevNovels) => {
      const updatedList = applyCoverOverrides(
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
      );
      saveCachedNovelsToStorage(updatedList);
      if (commitNote) {
        triggerAutoGitHubPush(updatedList, commitNote).catch(() => {});
      }
      return updatedList;
    });
  };

  const handlePublishChapter = async (
    novelId: string,
    title?: string,
    content?: string,
    chapterUrl?: string
  ) => {
    try {
      const res = await fetch(`/api/novels/${novelId}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, chapterUrl })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.novel && data.chapter) {
          mergeReturnedNovelAndChapter(
            data.novel,
            data.chapter,
            `feat(chapter): đăng chương ${data.chapter.number} truyện ${data.novel.title}`
          );
          await syncNovelAndChapterToFirestore(data.novel, data.chapter).catch(() => {});
          return;
        }
      }
    } catch {
      // Fallback to client-side chapter publish when running on static Vercel host
    }

    // Client-side fallback (for Vercel static deployment)
    const target = novels.find((n) => n.id === novelId);
    if (!target) return;

    let paragraphs: string[] = [];
    let resolvedTitle = title?.trim() || '';
    let resolvedSourceUrl = chapterUrl?.trim() || undefined;

    if (resolvedSourceUrl) {
      try {
        const extracted = await extractUrlClientSide(resolvedSourceUrl);
        if (extracted.paragraphs.length > 0) paragraphs = extracted.paragraphs;
        if (!resolvedTitle) resolvedTitle = extracted.chapterTitle || extracted.title;
      } catch {
        // ignore
      }
    }

    if (paragraphs.length === 0 && content && content.trim()) {
      paragraphs = content
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const nextNum =
      Math.max(target.chapters.length, ...target.chapters.map((c) => Number(c.number) || 0)) + 1;
    if (paragraphs.length === 0) {
      paragraphs = [`Nội dung chương ${nextNum} của "${target.title}".`];
    }
    const nowIso = new Date().toISOString();
    const newChapter: Chapter = {
      id: `${target.id}-c${nextNum}-${Date.now()}`,
      novelId: target.id,
      number: nextNum,
      title: resolvedTitle || `Chương ${nextNum}`,
      content: paragraphs,
      wordCount: paragraphs.reduce((acc, p) => acc + p.trim().split(/\s+/).length, 0),
      publishedAt: nowIso,
      ...(resolvedSourceUrl ? { sourceChapterUrl: resolvedSourceUrl } : {})
    };
    const updatedNovel: Novel = normalizeNovelChapters({
      ...target,
      updatedAt: nowIso,
      chapters: [...target.chapters, newChapter]
    });

    mergeReturnedNovelAndChapter(
      updatedNovel,
      newChapter,
      `feat(chapter): đăng chương ${newChapter.number} truyện ${updatedNovel.title}`
    );
    await syncNovelAndChapterToFirestore(updatedNovel, newChapter).catch(() => {});
  };

  const handleQuickAutoRelease = async (novelId?: string) => {
    try {
      const res = await fetch('/api/realtime/release-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.novel && data.chapter) {
          mergeReturnedNovelAndChapter(
            data.novel,
            data.chapter,
            `feat(chapter): cập nhật chương ${data.chapter.number} truyện ${data.novel.title}`
          );
          await syncNovelAndChapterToFirestore(data.novel, data.chapter).catch(() => {});
          return;
        }
      }
    } catch {
      // Fallback to handleSyncSingleNovelUrl
    }
    const targetId = novelId || novels[0]?.id;
    if (targetId) {
      await handleSyncSingleNovelUrl(targetId);
    }
  };

  const handleSyncSingleNovelUrl = async (novelId: string): Promise<number | null> => {
    if (syncingNovelId) return null;
    setSyncingNovelId(novelId);
    try {
      try {
        const res = await fetch(`/api/novels/${novelId}/sync-url`, {
          method: 'POST'
        });
        if (res.ok) {
          const data = await res.json();
          if (data.novel && data.chapter) {
            mergeReturnedNovelAndChapter(
              data.novel,
              data.chapter,
              `feat(sync): đồng bộ chương ${data.chapter.number} truyện ${data.novel.title}`
            );
            await syncNovelAndChapterToFirestore(data.novel, data.chapter).catch(() => {});
            return Number(data.chapter.number) || null;
          }
        }
      } catch {
        // Fallback to client-side URL sync on Vercel static host
      }

      const target = novels.find((n) => n.id === novelId);
      if (!target) return null;

      const pending = [...(target.pendingChapterLinks || [])];
      const nextLink = pending.shift();
      const urlToFetch = nextLink?.url || target.sourceUrl;
      if (!urlToFetch) return null;

      const extracted = await extractUrlClientSide(urlToFetch);
      if (extracted.nextChapterUrl && !pending.some((l) => l.url === extracted.nextChapterUrl)) {
        pending.unshift({
          title: extracted.nextChapterTitle || 'Chương tiếp theo',
          url: extracted.nextChapterUrl
        });
      }

      const nextNum =
        Math.max(target.chapters.length, ...target.chapters.map((c) => Number(c.number) || 0)) + 1;
      const nowIso = new Date().toISOString();
      const paragraphs =
        extracted.paragraphs.length > 0
          ? extracted.paragraphs
          : [`Nội dung chương ${nextNum} được đồng bộ từ ${urlToFetch}.`];

      const newChapter: Chapter = {
        id: `${target.id}-c${nextNum}-${Date.now()}`,
        novelId: target.id,
        number: nextNum,
        title: extracted.chapterTitle || nextLink?.title || `Chương ${nextNum}`,
        content: paragraphs,
        wordCount: paragraphs.reduce((acc, p) => acc + p.trim().split(/\s+/).length, 0),
        publishedAt: nowIso,
        sourceChapterUrl: urlToFetch
      };

      const updatedNovel: Novel = normalizeNovelChapters({
        ...target,
        updatedAt: nowIso,
        lastSyncedAt: nowIso,
        pendingChapterLinks: pending,
        chapters: [...target.chapters, newChapter]
      });

      mergeReturnedNovelAndChapter(
        updatedNovel,
        newChapter,
        `feat(sync): đồng bộ chương ${newChapter.number} truyện ${updatedNovel.title}`
      );
      await syncNovelAndChapterToFirestore(updatedNovel, newChapter).catch(() => {});
      return nextNum;
    } catch {
      return null;
    } finally {
      setSyncingNovelId(null);
    }
  };

  const handleCreateNovel = async (payload: CreateNovelPayload) => {
    let createdNovel: Novel | null = null;
    try {
      const res = await fetch('/api/novels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.novel) createdNovel = data.novel;
      }
    } catch {
      // Fallback to client-side novel creation on Vercel static host
    }

    if (!createdNovel) {
      const slugId =
        payload.title
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') +
        '-' +
        Math.floor(100 + Math.random() * 900);
      const nowIso = new Date().toISOString();
      const paragraphs = payload.firstChapterContent
        ? payload.firstChapterContent
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [payload.synopsis || `Chương mở đầu của ${payload.title}.`];
      const chap1: Chapter = {
        id: `${slugId}-c1`,
        novelId: slugId,
        number: 1,
        title: payload.firstChapterTitle || 'Khởi đầu hành trình',
        content: paragraphs,
        wordCount: paragraphs.reduce((acc, p) => acc + p.trim().split(/\s+/).length, 0),
        publishedAt: nowIso
      };
      createdNovel = {
        id: slugId,
        title: payload.title,
        author: payload.author || 'Ẩn Danh',
        genre: payload.genre || 'Tiên Hiệp',
        status: 'Đang ra',
        synopsis: payload.synopsis || `Tác phẩm ${payload.genre} của ${payload.author}.`,
        coverStyle: payload.coverStyle || 'ink-mountain',
        ...(payload.coverImageUrl ? { coverImageUrl: payload.coverImageUrl } : {}),
        views: 1,
        rating: 5.0,
        updatedAt: nowIso,
        chapters: [chap1]
      };
    }

    const finalNovel = createdNovel;
    setNovels((prev) => {
      const next = prev.some((n) => n.id === finalNovel.id)
        ? prev
        : applyCoverOverrides([finalNovel, ...prev]);
      saveCachedNovelsToStorage(next);
      triggerAutoGitHubPush(next, `feat(novel): thêm truyện mới ${finalNovel.title}`).catch(
        () => {}
      );
      return next;
    });
    setBookmarkedIds((prev) => (prev.includes(finalNovel.id) ? prev : [finalNovel.id, ...prev]));
    await syncNovelAndChapterToFirestore(finalNovel, finalNovel.chapters?.[0]).catch(() => {});
    await syncUserProgressToFirestore(finalNovel.id, 1, true, finalNovel).catch(() => {});
  };

  const handleImportUrlNovel = async (payload: ImportUrlPayload) => {
    let importedNovel: Novel | null = null;
    try {
      const res = await fetch('/api/novels/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.novel) importedNovel = data.novel;
      }
    } catch {
      // Fallback to client-side URL import when running on Vercel static host
    }

    if (!importedNovel) {
      const extracted = await extractUrlClientSide(payload.url);
      importedNovel = buildNovelFromClientExtraction(extracted, payload);
    }

    const finalNovel = importedNovel;
    setNovels((prev) => {
      const next = prev.some((n) => n.id === finalNovel.id)
        ? prev
        : applyCoverOverrides([finalNovel, ...prev]);
      saveCachedNovelsToStorage(next);
      triggerAutoGitHubPush(next, `feat(import): đồng bộ truyện ${finalNovel.title} từ URL`).catch(
        () => {}
      );
      return next;
    });
    setBookmarkedIds((prev) => (prev.includes(finalNovel.id) ? prev : [finalNovel.id, ...prev]));
    await syncNovelAndChapterToFirestore(finalNovel, finalNovel.chapters?.[0]).catch(() => {});
    await syncUserProgressToFirestore(finalNovel.id, 1, true, finalNovel).catch(() => {});
  };

  const handleDeleteNovel = async (novelId: string) => {
    if (!isAdmin) return;
    setNovels((prev) => {
      const next = prev.filter((n) => n.id !== novelId);
      saveCachedNovelsToStorage(next);
      triggerAutoGitHubPush(next, `chore(novel): xoá truyện ${novelId}`).catch(() => {});
      return next;
    });
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
    setNovels((prev) => {
      const nextList = prev.map((novel) => {
        if (novel.id !== novelId) return novel;
        const nextNovel: Novel = {
          ...novel,
          coverStyle: updates.coverStyle,
          coverImageUrl: updates.coverImageUrl || undefined
        };
        updatedTarget = nextNovel;
        return nextNovel;
      });
      saveCachedNovelsToStorage(nextList);
      triggerAutoGitHubPush(nextList, `style(cover): cập nhật bìa truyện ${novelId}`).catch(
        () => {}
      );
      return nextList;
    });

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
            onFetchNextChapter={isAdmin ? () => handleSyncSingleNovelUrl(activeNovel.id) : undefined}
            isFetchingNextChapter={syncingNovelId === activeNovel.id}
          />
          {openingBookAnim && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-xs pointer-events-none">
              <div className="relative w-52 sm:w-60 aspect-[3/4.2] animate-book-stage">
                {/* Inside Right Page of the Opening Book */}
                <div className="absolute inset-0 rounded-r-xl rounded-l-sm bg-[#FBF9F5] dark:bg-[#1C1917] border border-amber-900/30 dark:border-stone-700 shadow-2xl p-5 flex flex-col justify-between overflow-hidden">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono-num uppercase tracking-widest text-amber-800 dark:text-amber-400">
                      Mạc Thư Các · Chương {openingBookAnim.chapterNumber}
                    </span>
                    <h4 className="font-display text-lg font-bold text-stone-900 dark:text-stone-100 line-clamp-2 leading-snug">
                      {openingBookAnim.novel.title}
                    </h4>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                      {openingBookAnim.novel.author}
                    </p>
                  </div>
                  <div className="space-y-2 opacity-60">
                    <div className="h-1.5 w-full rounded bg-stone-300 dark:bg-stone-700" />
                    <div className="h-1.5 w-11/12 rounded bg-stone-300 dark:bg-stone-700" />
                    <div className="h-1.5 w-4/5 rounded bg-stone-300 dark:bg-stone-700" />
                    <div className="h-1.5 w-full rounded bg-stone-300 dark:bg-stone-700" />
                    <div className="h-1.5 w-3/4 rounded bg-stone-300 dark:bg-stone-700" />
                  </div>
                  <div className="text-right text-[10px] font-mono-num text-stone-400">
                    Trang 1
                  </div>
                </div>

                {/* Book Spine Shadow */}
                <div className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/45 to-transparent z-10 pointer-events-none rounded-l-sm" />

                {/* 3D Flipping Front Cover */}
                <div className="absolute inset-0 rounded-r-xl rounded-l-sm overflow-hidden z-20 animate-book-cover-flip">
                  <BookCoverArtwork
                    styleType={openingBookAnim.novel.coverStyle}
                    coverImageUrl={openingBookAnim.novel.coverImageUrl}
                    title={openingBookAnim.novel.title}
                    author={openingBookAnim.novel.author}
                    genre={openingBookAnim.novel.genre}
                    className="w-full h-full"
                  />
                </div>
              </div>
            </div>
          )}
          {expGainToast && (
            <div className="fixed bottom-20 right-4 z-50 px-4 py-2.5 rounded-xl bg-[#181824]/95 text-white text-xs font-semibold border border-purple-500/40 shadow-2xl flex items-center gap-2 pointer-events-none">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{expGainToast}</span>
            </div>
          )}
          {levelUpNotice && (
            <div className="fixed bottom-16 left-4 z-[60] w-64 sm:w-72 px-3 py-2.5 rounded-md bg-[#181824] text-stone-100 border border-amber-500/50 border-l-4 border-l-amber-400 shadow-xl flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded bg-amber-500/15 border border-amber-400/40 flex flex-col items-center justify-center shrink-0">
                  <span className="text-[9px] font-bold uppercase text-amber-300 leading-none">LV</span>
                  <span className="text-xs font-mono-num font-extrabold text-amber-400 leading-tight">
                    {levelUpNotice.level}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400 truncate">
                    Lên cấp mới!
                  </p>
                  <p className="text-xs font-semibold text-white truncate">
                    {levelUpNotice.titleName} · <span className="text-stone-400">{levelUpNotice.rarity}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLevelUpNotice(null)}
                className="p-1 rounded text-stone-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
                aria-label="Đóng thông báo lên cấp"
              >
                <X className="w-3.5 h-3.5" />
              </button>
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

  const featuredNovel =
    novels.find((n) => isPriorityFeaturedNovel(n)) || novels[0] || null;
  const latestFeaturedChapter =
    featuredNovel && featuredNovel.chapters.length > 0
      ? featuredNovel.chapters[featuredNovel.chapters.length - 1]
      : null;
  const bookmarkedNovels = novels.filter((n) => bookmarkedIds.includes(n.id));
  const readingHistoryItems = Object.values(progressMap)
    .map((progress) => {
      const novel = novels.find((n) => n.id === progress.novelId);
      return novel ? { novel, progress } : null;
    })
    .filter((item): item is { novel: Novel; progress: ReadingProgress } => item !== null)
    .sort(
      (a, b) =>
        new Date(b.progress.updatedAt).getTime() - new Date(a.progress.updatedAt).getTime()
    );

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

        {/* Right Zone: User Avatar & Dropdown Menu */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0" ref={avatarMenuRef}>
          {/* Top-right Avatar Trigger */}
          <div className="relative flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                setIsAvatarMenuOpen((prev) => !prev);
              }}
              className={`w-10 h-10 rounded-full p-[2.5px] overflow-hidden focus:outline-none cursor-pointer transition-transform active:scale-95 ${activeTitleTheme.ringClass} ${activeTitleTheme.glowClass}`}
              aria-label="Mở menu tài khoản"
              title={`${userProfile.nickname} · ${activeTitleTheme.name}`}
            >
              <div className="relative w-full h-full rounded-full overflow-hidden bg-stone-900">
                <img
                  src={userProfile.avatarUrl}
                  alt={userProfile.nickname}
                  className="w-full h-full rounded-full object-cover"
                />
              </div>
            </button>

            {/* Dropdown Menu + Google Sign In / Sign Up */}
            {isAvatarMenuOpen && (
              <div
                className="absolute right-0 top-full mt-3 w-72 sm:w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl text-stone-100 overflow-hidden z-50 select-none bg-[#191924] border border-white/10 shadow-2xl"
              >
                {/* User Header Info */}
                <div className="p-4 sm:p-5 flex items-center gap-3.5 border-b border-white/15 bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setActiveProfileSection('profile');
                    }}
                    className={`relative w-13 h-13 sm:w-14 sm:h-14 rounded-full p-[3px] shrink-0 overflow-hidden cursor-pointer transition-transform active:scale-95 ${activeTitleTheme.ringClass} ${activeTitleTheme.glowClass}`}
                    title="Nhấn để chỉnh sửa Hồ sơ & Avatar"
                  >
                    <div className="relative w-full h-full rounded-full overflow-hidden bg-[#191924]">
                      <img
                        src={userProfile.avatarUrl}
                        alt={userProfile.nickname}
                        className="w-full h-full rounded-full object-cover"
                      />
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
                      className="w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-2 text-sm font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 transition-all cursor-pointer mb-1"
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
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
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
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
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
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
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
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center justify-between text-sm font-medium text-stone-100 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
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
                    className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-medium text-stone-100 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
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
                      className="w-full px-3.5 py-2.5 rounded-xl flex items-center gap-3.5 text-sm font-semibold text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
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
                  onClick={() => {
                    setActiveTab('history');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center justify-between text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === 'history'
                      ? 'bg-amber-900/10 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300 font-semibold'
                      : 'text-stone-700 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 shrink-0 text-amber-800 dark:text-amber-400" />
                    <span>Lịch sử đọc</span>
                  </div>
                  <span className="font-mono-num text-[11px] opacity-75">
                    {readingHistoryItems.length}
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

              {/* Quick Reading History List inside Hamburger Menu */}
              <div className="pt-4 border-t border-stone-200 dark:border-stone-800 space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                    Đọc gần đây
                  </span>
                  {readingHistoryItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('history');
                        setIsMenuOpen(false);
                      }}
                      className="text-[11px] font-medium text-amber-800 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      Xem tất cả ({readingHistoryItems.length})
                    </button>
                  )}
                </div>

                {readingHistoryItems.length === 0 ? (
                  <p className="px-1 text-[11px] text-stone-400 dark:text-stone-500 italic">
                    Chưa có lịch sử đọc truyện nào.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {readingHistoryItems.slice(0, 5).map(({ novel, progress }) => (
                      <div
                        key={novel.id}
                        className="group flex items-center justify-between gap-2 p-2 rounded-xl bg-stone-200/40 dark:bg-stone-800/50 hover:bg-amber-900/10 dark:hover:bg-amber-500/15 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            openReader(novel.id, progress.chapterNumber);
                          }}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="w-8 aspect-[3/4] shrink-0 rounded overflow-hidden">
                            <BookCoverArtwork
                              styleType={novel.coverStyle}
                              coverImageUrl={novel.coverImageUrl}
                              title={novel.title}
                              author={novel.author}
                              compact
                              className="w-full h-full"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">
                              {novel.title}
                            </p>
                            <p className="text-[10px] text-stone-500 dark:text-stone-400 truncate mt-0.5">
                              Chương {progress.chapterNumber}/{novel.chapters.length} ·{' '}
                              {formatRelativeTime(progress.updatedAt)}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveFromHistory(novel.id)}
                          className="p-1.5 rounded-lg text-stone-400 hover:text-rose-500 hover:bg-stone-300/50 dark:hover:bg-stone-700/60 transition-colors shrink-0 cursor-pointer"
                          title="Xoá khỏi lịch sử"
                          aria-label="Xoá khỏi lịch sử"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
              <p>Giọng đọc Nữ · Đọc tự động</p>
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
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleQuickAutoRelease()}
                  className="font-medium text-amber-800 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Lấy chương mới ngay</span>
                </button>
              )}
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
                  Hiện chưa có tác phẩm nào trên kệ sách. Quản trị viên có thể thêm và đồng bộ truyện mới trong mục Quản trị Admin.
                </p>
              </div>
              {isAdmin && (
                <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveProfileSection('admin')}
                    className="min-h-[38px] px-4 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-semibold flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-400 dark:text-amber-600" />
                    <span>Mở Trung Tâm Quản Trị Admin</span>
                  </button>
                </div>
              )}
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
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      disabled={syncingNovelId === novel.id}
                                      onClick={() => handleSyncSingleNovelUrl(novel.id)}
                                      className="p-1.5 rounded-md border border-stone-300 dark:border-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 cursor-pointer"
                                      title={novel.sourceUrl ? 'Quét chương mới từ URL nguồn' : 'Lấy chương mới tiếp theo'}
                                    >
                                      <RefreshCw className={`w-3 h-3 ${syncingNovelId === novel.id ? 'animate-spin' : ''}`} />
                                    </button>
                                  )}

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
              {isAdmin && (
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
              )}
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
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingCoverNovelId(novel.id)}
                                className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-200/50 dark:hover:bg-stone-800 flex items-center gap-1 cursor-pointer"
                                title="Chỉnh bìa sách & Lấy ảnh từ thư viện"
                              >
                                <Palette className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                                <span className="hidden sm:inline">Chỉnh bìa</span>
                              </button>
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
                            </>
                          )}
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

        {/* TAB 4: READING HISTORY (LỊCH SỬ ĐỌC) */}
        {activeTab === 'history' && (
          <section className="space-y-6">
            <div className="border-b border-stone-200 dark:border-stone-800 pb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100">
                  Lịch Sử Đọc Truyện
                </h1>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  Danh sách các tác phẩm và chương bạn đã đọc gần đây
                </p>
              </div>
              {readingHistoryItems.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearReadingHistory}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-800 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xoá toàn bộ lịch sử</span>
                </button>
              )}
            </div>

            {readingHistoryItems.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <p className="text-sm text-stone-500">Bạn chưa có lịch sử đọc truyện nào.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('discover')}
                  className="px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium cursor-pointer"
                >
                  Khám phá truyện ngay
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {readingHistoryItems.map(({ novel, progress }) => {
                  const readChapter =
                    novel.chapters.find((c) => c.number === progress.chapterNumber) ||
                    novel.chapters[novel.chapters.length - 1];
                  return (
                    <div
                      key={novel.id}
                      className="flex items-center justify-between gap-4 pb-5 border-b border-stone-200/70 dark:border-stone-800/80"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div
                          onClick={() => openReader(novel.id, progress.chapterNumber)}
                          className="w-16 aspect-[3/4] shrink-0 cursor-pointer group"
                        >
                          <BookCoverArtwork
                            styleType={novel.coverStyle}
                            coverImageUrl={novel.coverImageUrl}
                            title={novel.title}
                            author={novel.author}
                            compact
                            className="w-full h-full rounded-md"
                          />
                        </div>
                        <div className="min-w-0">
                          <h3
                            onClick={() => openReader(novel.id, progress.chapterNumber)}
                            className="font-display text-lg font-bold text-stone-900 dark:text-stone-100 truncate hover:text-amber-800 dark:hover:text-amber-400 cursor-pointer"
                          >
                            {novel.title}
                          </h3>
                          <p className="text-xs text-stone-600 dark:text-stone-300 mt-0.5 truncate">
                            Đang đọc: Chương {progress.chapterNumber} / {novel.chapters.length}
                            {readChapter?.title ? ` · ${readChapter.title}` : ''}
                          </p>
                          <p className="text-[11px] text-amber-800 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3 shrink-0" />
                            <span>Đọc lần cuối: {formatRelativeTime(progress.updatedAt)}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRemoveFromHistory(novel.id)}
                          className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-800 text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-stone-200/50 dark:hover:bg-stone-800 transition-colors flex items-center justify-center cursor-pointer"
                          title="Xoá khỏi lịch sử đọc"
                          aria-label="Xoá khỏi lịch sử đọc"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openReader(novel.id, progress.chapterNumber)}
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

      {githubSyncToast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl bg-stone-900/95 dark:bg-stone-100/95 text-white dark:text-stone-950 text-xs font-medium shadow-xl border border-white/10 flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-amber-400 dark:text-amber-600 shrink-0" />
          <span className="leading-snug">{githubSyncToast}</span>
        </div>
      )}

      {/* Small Rectangular Bottom-Left Level-Up Notification Box */}
      {levelUpNotice && (
        <div className="fixed bottom-4 left-4 z-[60] w-64 sm:w-72 px-3 py-2.5 rounded-md bg-[#181824] text-stone-100 border border-amber-500/50 border-l-4 border-l-amber-400 shadow-xl flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded bg-amber-500/15 border border-amber-400/40 flex flex-col items-center justify-center shrink-0">
              <span className="text-[9px] font-bold uppercase text-amber-300 leading-none">LV</span>
              <span className="text-xs font-mono-num font-extrabold text-amber-400 leading-tight">
                {levelUpNotice.level}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400 truncate">
                Lên cấp mới!
              </p>
              <p className="text-xs font-semibold text-white truncate">
                {levelUpNotice.titleName} · <span className="text-stone-400">{levelUpNotice.rarity}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLevelUpNotice(null)}
            className="p-1 rounded text-stone-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
            aria-label="Đóng thông báo lên cấp"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <PublishChapterModal
        isOpen={isAdmin && modalState.isOpen}
        initialMode={modalState.mode}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        novels={novels}
        onPublish={handlePublishChapter}
        onQuickAutoRelease={handleQuickAutoRelease}
        onCreateNovel={handleCreateNovel}
        onImportUrlNovel={handleImportUrlNovel}
        onPushToGitHub={handlePushToGitHub}
        onPullFromGitHub={handlePullFromGitHub}
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
