import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Sliders,
  Bell,
  X,
  Sparkles,
  Check,
  Gauge,
  RefreshCw
} from 'lucide-react';
import {
  Novel,
  Chapter,
  ReaderSettings,
  FEMALE_VOICE_OPTIONS,
  FemaleVoiceOption,
  getFemaleVoiceOption
} from '../types';

interface ReaderViewProps {
  novel: Novel;
  chapter: Chapter;
  settings: ReaderSettings;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onSelectChapter: (chapterNumber: number) => void;
  onBackToCatalog: () => void;
  newChapterAlert: { novelId: string; chapterNumber: number; title: string } | null;
  onDismissNewChapterAlert: () => void;
  onFetchNextChapter?: () => Promise<number | null>;
  isFetchingNextChapter?: boolean;
}

const PLAYBACK_SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function applyYoutubeStylePlaybackSpeed(audioEl: HTMLAudioElement, speed: number) {
  const safeSpeed = Math.max(0.5, Math.min(2.0, Number(speed) || 1.0));
  const extAudio = audioEl as HTMLAudioElement & {
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };

  // Enable pitch-preserving time-stretching (WSOLA) only if not already enabled
  if (audioEl.preservesPitch !== true) {
    audioEl.preservesPitch = true;
  }
  if (extAudio.mozPreservesPitch !== true) {
    extAudio.mozPreservesPitch = true;
  }
  if (extAudio.webkitPreservesPitch !== true) {
    extAudio.webkitPreservesPitch = true;
  }

  // Only update playbackRate when it actually changes to avoid flushing the WSOLA audio buffer mid-speech
  if (Math.abs(audioEl.defaultPlaybackRate - safeSpeed) > 0.005) {
    audioEl.defaultPlaybackRate = safeSpeed;
  }
  if (Math.abs(audioEl.playbackRate - safeSpeed) > 0.005) {
    audioEl.playbackRate = safeSpeed;
  }
}

function pickBrowserFemaleViVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const viVoices = voices.filter((v) => v.lang.toLowerCase().includes('vi'));
  if (viVoices.length === 0) return null;

  const femaleMatch = viVoices.find(
    (v) =>
      /hoaimy|linh|female|nữ|nu|google/i.test(v.name) &&
      !/namminh|male|nam\b/i.test(v.name)
  );
  if (femaleMatch) return femaleMatch;

  const nonMale = viVoices.find((v) => !/namminh|male|nam\b/i.test(v.name));
  return nonMale || viVoices[0];
}

interface WeightedWordToken {
  word: string;
  space: string;
  startRatio: number;
  endRatio: number;
}

function buildWeightedTokens(text: string): WeightedWordToken[] {
  const matches = Array.from(text.matchAll(/(\S+)(\s*)/g));
  if (matches.length === 0) return [];

  const weights = matches.map((m) => {
    const word = m[1];
    let w = Math.max(1.6, word.length);
    if (/[,;:]/.test(word)) w += 2.6;
    if (/[.!?…—]/.test(word)) w += 4.2;
    return w;
  });

  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || 1;
  let cumulative = 0;

  return matches.map((m, i) => {
    const startRatio = cumulative / totalWeight;
    cumulative += weights[i];
    const endRatio = cumulative / totalWeight;
    return {
      word: m[1],
      space: m[2] || '',
      startRatio,
      endRatio
    };
  });
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  novel,
  chapter,
  settings,
  onUpdateSettings,
  onSelectChapter,
  onBackToCatalog,
  newChapterAlert,
  onDismissNewChapterAlert,
  onFetchNextChapter,
  isFetchingNextChapter = false
}) => {
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const [sentenceProgress, setSentenceProgress] = useState<number>(0);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [showChaptersDrawer, setShowChaptersDrawer] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState<number | null>(null);

  const autoScrollFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const countdownTimerRef = useRef<number | null>(null);
  const ttsProgressFrameRef = useRef<number | null>(null);
  const segmentStartTimeRef = useRef<number>(0);
  const segmentEstimatedDurationRef = useRef<number>(4000);
  const fallbackBoundaryProgressRef = useRef<number | null>(null);
  const activeParagraphRefs = useRef<Record<number, HTMLElement | null>>({});

  // HTML5 Audio element with preservesPitch=true + lookahead pre-fetching for smooth gapless reading
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedAudioMapRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const ttsBlobUrlCacheRef = useRef<Map<string, string>>(new Map());
  const ttsInFlightMapRef = useRef<Map<string, Promise<string>>>(new Map());
  const usingFallbackSynthRef = useRef<boolean>(false);
  const speechSessionRef = useRef<number>(0);
  const settingsRef = useRef<ReaderSettings>(settings);
  const chapterRef = useRef<Chapter>(chapter);
  const novelRef = useRef<Novel>(novel);
  const isSpeakingRef = useRef<boolean>(isSpeaking);
  const shouldAutoStartNewChapterRef = useRef<boolean>(false);

  chapterRef.current = chapter;
  novelRef.current = novel;
  isSpeakingRef.current = isSpeaking;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const activeVoice = getFemaleVoiceOption(settings.ttsVoiceId);
  const sortedChapters = React.useMemo(
    () => [...novel.chapters].sort((a, b) => a.number - b.number),
    [novel.chapters]
  );
  const currentChapIdx = sortedChapters.findIndex((c) => c.number === chapter.number);
  const prevChapterNumber = currentChapIdx > 0 ? sortedChapters[currentChapIdx - 1].number : null;
  const nextChapterNumber =
    currentChapIdx >= 0 && currentChapIdx < sortedChapters.length - 1
      ? sortedChapters[currentChapIdx + 1].number
      : null;
  const hasPrev = prevChapterNumber !== null;
  const hasNext = nextChapterNumber !== null;

  const stopAudioNodes = () => {
    speechSessionRef.current += 1;
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.onended = null;
        activeAudioRef.current.onerror = null;
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      activeAudioRef.current = null;
    }
    if (usingFallbackSynthRef.current && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      usingFallbackSynthRef.current = false;
    }
  };

  // Fetch & decode TTS audio into a cached Blob URL + pre-warmed HTMLAudioElement (deduplicated)
  const ensureAudioBlobUrl = (text: string, voiceId: string): Promise<string> => {
    const cleanText = text.trim();
    const cacheKey = `${voiceId || 'quynh-anh-4-0'}::${cleanText}`;
    const cachedUrl = ttsBlobUrlCacheRef.current.get(cacheKey);
    if (cachedUrl) {
      return Promise.resolve(cachedUrl);
    }

    const existingPromise = ttsInFlightMapRef.current.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = (async () => {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voiceId
          })
        });

        if (!res.ok) throw new Error('TTS API fallback');
        const data = await res.json();
        if (!data.audioBase64) throw new Error('Empty audio');

        const binaryStr = window.atob(data.audioBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: data.mimeType || 'audio/mpeg' });
        const objectUrl = URL.createObjectURL(blob);
        ttsBlobUrlCacheRef.current.set(cacheKey, objectUrl);

        // Pre-warm an HTMLAudioElement in memory so playback starts with 0ms decoding lag
        const warmAudio = new Audio(objectUrl);
        warmAudio.preload = 'auto';
        applyYoutubeStylePlaybackSpeed(warmAudio, settingsRef.current.ttsRate || 1.0);
        warmAudio.load();
        preloadedAudioMapRef.current.set(cacheKey, warmAudio);

        return objectUrl;
      } finally {
        ttsInFlightMapRef.current.delete(cacheKey);
      }
    })();

    ttsInFlightMapRef.current.set(cacheKey, fetchPromise);
    return fetchPromise;
  };

  // Pre-fetch upcoming paragraphs in the background so transitions never wait on network
  const prefetchUpcomingParagraphs = (
    paragraphs: string[],
    fromIndex: number,
    count: number,
    voiceId: string
  ) => {
    for (let i = fromIndex; i < Math.min(paragraphs.length, fromIndex + count); i++) {
      const text = paragraphs[i];
      if (text && text.trim()) {
        ensureAudioBlobUrl(text, voiceId).catch(() => {});
      }
    }
  };

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      if (autoScrollFrameRef.current) {
        cancelAnimationFrame(autoScrollFrameRef.current);
      }
      if (ttsProgressFrameRef.current) {
        cancelAnimationFrame(ttsProgressFrameRef.current);
      }
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
      }
      stopAudioNodes();
    };
  }, []);

  // Real-time progressive highlight animation loop & gentle auto-scroll to active paragraph
  useEffect(() => {
    if (!isSpeaking || activeSentenceIndex === null) {
      if (ttsProgressFrameRef.current) {
        cancelAnimationFrame(ttsProgressFrameRef.current);
        ttsProgressFrameRef.current = null;
      }
      setSentenceProgress(0);
      return;
    }

    // Gently keep the currently read paragraph within comfortable reading view
    const activeEl = activeParagraphRefs.current[activeSentenceIndex];
    if (activeEl && !isAutoScrolling) {
      const rect = activeEl.getBoundingClientRect();
      const vh = window.innerHeight;
      if (rect.top < vh * 0.16 || rect.bottom > vh * 0.82) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    let lastReported = -1;
    const updateProgressFrame = () => {
      let nextProgress = 0;
      const audio = activeAudioRef.current;

      if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
        nextProgress = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
      } else if (fallbackBoundaryProgressRef.current !== null) {
        nextProgress = fallbackBoundaryProgressRef.current;
      } else {
        const elapsed = Math.max(0, performance.now() - segmentStartTimeRef.current);
        nextProgress = Math.min(0.96, elapsed / Math.max(800, segmentEstimatedDurationRef.current));
      }

      if (Math.abs(nextProgress - lastReported) >= 0.006) {
        lastReported = nextProgress;
        setSentenceProgress(nextProgress);
      }

      ttsProgressFrameRef.current = requestAnimationFrame(updateProgressFrame);
    };

    ttsProgressFrameRef.current = requestAnimationFrame(updateProgressFrame);

    return () => {
      if (ttsProgressFrameRef.current) {
        cancelAnimationFrame(ttsProgressFrameRef.current);
        ttsProgressFrameRef.current = null;
      }
    };
  }, [isSpeaking, activeSentenceIndex, isAutoScrolling]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setAutoAdvanceCountdown(null);
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    // Warm up the first 2 segments of the chapter in the background for instant start
    const chapterParagraphs = [`Chương ${chapter.number}: ${chapter.title}`, ...chapter.content];
    prefetchUpcomingParagraphs(chapterParagraphs, 0, 2, settingsRef.current.ttsVoiceId);

    const shouldContinue = shouldAutoStartNewChapterRef.current || isSpeakingRef.current;
    shouldAutoStartNewChapterRef.current = false;

    if (shouldContinue) {
      stopAudioNodes();
      const timerId = window.setTimeout(() => {
        startSpeech(0);
      }, 80);
      return () => window.clearTimeout(timerId);
    }
  }, [chapter.id]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(100, Math.max(0, Math.round((scrollTop / docHeight) * 100))) : 100;
      setScrollProgress(pct);

      if (isAutoScrolling && docHeight > 20 && scrollTop >= docHeight - 6) {
        setIsAutoScrolling(false);
        if (settings.autoNextChapter && chapter.number < novel.chapters.length) {
          triggerAutoNextCountdown();
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isAutoScrolling, settings.autoNextChapter, chapter.number, novel.chapters.length]);

  const triggerAutoNextCountdown = () => {
    if (countdownTimerRef.current) return;
    let remaining = 3;
    setAutoAdvanceCountdown(remaining);
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current) {
          window.clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setAutoAdvanceCountdown(null);
        onSelectChapter(chapter.number + 1);
        window.setTimeout(() => setIsAutoScrolling(true), 500);
      } else {
        setAutoAdvanceCountdown(remaining);
      }
    }, 1000);
  };

  useEffect(() => {
    if (!isAutoScrolling) {
      if (autoScrollFrameRef.current) {
        cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      return;
    }

    lastFrameTimeRef.current = performance.now();

    const step = (now: number) => {
      const dt = (now - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = now;

      const pixelsPerSecond = 14 + settings.autoScrollSpeed * 13.5;
      window.scrollBy(0, pixelsPerSecond * dt);

      autoScrollFrameRef.current = requestAnimationFrame(step);
    };

    autoScrollFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (autoScrollFrameRef.current) {
        cancelAnimationFrame(autoScrollFrameRef.current);
      }
    };
  }, [isAutoScrolling, settings.autoScrollSpeed]);

  // Play a single text segment using pre-warmed HTML5 Audio with preservesPitch=true
  const playFemaleVoiceSegment = async (
    text: string,
    voiceOption: FemaleVoiceOption,
    requestedSpeed: number,
    sessionId: number,
    onDone: () => void,
    onError: () => void
  ) => {
    const initialSpeed = Math.max(0.5, Math.min(2.0, Number(requestedSpeed) || voiceOption.baseRate || 1.0));
    const cleanText = text.trim();
    const cacheKey = `${voiceOption.id}::${cleanText}`;

    fallbackBoundaryProgressRef.current = null;
    segmentStartTimeRef.current = performance.now();
    segmentEstimatedDurationRef.current = Math.max(
      1400,
      (cleanText.length / (14.2 * initialSpeed)) * 1000
    );
    setSentenceProgress(0);

    try {
      const objectUrl = await ensureAudioBlobUrl(cleanText, voiceOption.id);
      if (sessionId !== speechSessionRef.current) return;

      // Reuse pre-warmed HTMLAudioElement if available for instant zero-stutter start
      let audio = preloadedAudioMapRef.current.get(cacheKey);
      if (audio) {
        preloadedAudioMapRef.current.delete(cacheKey);
        audio.currentTime = 0;
      } else {
        audio = new Audio(objectUrl);
        audio.preload = 'auto';
      }

      const currentSpeed = Math.max(
        0.5,
        Math.min(2.0, Number(settingsRef.current.ttsRate) || initialSpeed)
      );
      applyYoutubeStylePlaybackSpeed(audio, currentSpeed);

      audio.onended = () => {
        if (sessionId !== speechSessionRef.current) return;
        setSentenceProgress(1);
        onDone();
      };

      audio.onerror = () => {
        if (sessionId !== speechSessionRef.current) return;
        onError();
      };

      segmentStartTimeRef.current = performance.now();
      activeAudioRef.current = audio;
      await audio.play();
      return;
    } catch {
      if (sessionId !== speechSessionRef.current) return;
      if (!('speechSynthesis' in window)) {
        onError();
        return;
      }
      usingFallbackSynthRef.current = true;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'vi-VN';
      const femaleViVoice = pickBrowserFemaleViVoice();
      if (femaleViVoice) {
        utterance.voice = femaleViVoice;
      }
      const latestSpeed = Math.max(
        0.5,
        Math.min(2.0, Number(settingsRef.current.ttsRate) || initialSpeed)
      );
      utterance.rate = latestSpeed;
      utterance.pitch = 1.0;
      segmentStartTimeRef.current = performance.now();
      segmentEstimatedDurationRef.current = Math.max(
        1400,
        (cleanText.length / (14.2 * latestSpeed)) * 1000
      );
      utterance.onboundary = (event) => {
        if (sessionId !== speechSessionRef.current) return;
        if (typeof event.charIndex === 'number' && cleanText.length > 0) {
          fallbackBoundaryProgressRef.current = Math.min(
            0.98,
            Math.max(0, (event.charIndex + (event.charLength || 3)) / cleanText.length)
          );
        }
      };
      utterance.onend = () => {
        if (sessionId !== speechSessionRef.current) return;
        usingFallbackSynthRef.current = false;
        setSentenceProgress(1);
        onDone();
      };
      utterance.onerror = () => {
        if (sessionId !== speechSessionRef.current) return;
        usingFallbackSynthRef.current = false;
        onError();
      };
      window.speechSynthesis.speak(utterance);
    }
  };

  const startSpeech = (startIndex = 0, overrideVoice?: FemaleVoiceOption, overrideRate?: number) => {
    stopAudioNodes();
    setPreviewingVoiceId(null);

    const activeChap = chapterRef.current;
    const activeNovel = novelRef.current;
    const orderedChaps = [...activeNovel.chapters].sort((a, b) => a.number - b.number);
    const nextChapObj = orderedChaps.find((c) => c.number > activeChap.number);
    const hasNextChap = Boolean(nextChapObj);

    const sessionId = speechSessionRef.current;
    const paragraphs = [`Chương ${activeChap.number}: ${activeChap.title}`, ...activeChap.content];

    if (startIndex >= paragraphs.length) {
      if (hasNextChap && nextChapObj) {
        shouldAutoStartNewChapterRef.current = true;
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        setActiveSentenceIndex(0);
        setSentenceProgress(0);
        onSelectChapter(nextChapObj.number);
      } else if (settingsRef.current.autoNextChapter && onFetchNextChapter) {
        shouldAutoStartNewChapterRef.current = true;
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        setActiveSentenceIndex(0);
        setSentenceProgress(0);
        onFetchNextChapter()
          .then((newChapNum) => {
            if (newChapNum) {
              onSelectChapter(newChapNum);
            } else {
              shouldAutoStartNewChapterRef.current = false;
              isSpeakingRef.current = false;
              setIsSpeaking(false);
              setActiveSentenceIndex(null);
            }
          })
          .catch(() => {
            shouldAutoStartNewChapterRef.current = false;
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            setActiveSentenceIndex(null);
          });
      } else {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setActiveSentenceIndex(null);
        setSentenceProgress(0);
      }
      return;
    }

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setActiveSentenceIndex(startIndex);
    setSentenceProgress(0);

    const voiceToUse = overrideVoice || getFemaleVoiceOption(settingsRef.current.ttsVoiceId);
    const rateToUse = overrideRate ?? settingsRef.current.ttsRate;

    // Immediately pre-fetch and pre-decode the next 3 paragraphs in the background while current one plays
    prefetchUpcomingParagraphs(paragraphs, startIndex + 1, 3, voiceToUse.id);

    // When nearing the end of the current chapter, also pre-fetch the first 2 segments of the next chapter for zero-delay chapter transition
    if (hasNextChap && startIndex >= Math.max(0, paragraphs.length - 2)) {
      const nextChap = activeNovel.chapters.find((c) => c.number === activeChap.number + 1);
      if (nextChap) {
        const nextChapParagraphs = [
          `Chương ${nextChap.number}: ${nextChap.title}`,
          ...nextChap.content.slice(0, 1)
        ];
        prefetchUpcomingParagraphs(nextChapParagraphs, 0, 2, voiceToUse.id);
      }
    }

    playFemaleVoiceSegment(
      paragraphs[startIndex],
      voiceToUse,
      rateToUse,
      sessionId,
      () => {
        startSpeech(startIndex + 1);
      },
      () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setActiveSentenceIndex(null);
        setSentenceProgress(0);
      }
    );
  };

  const stopSpeech = () => {
    shouldAutoStartNewChapterRef.current = false;
    isSpeakingRef.current = false;
    stopAudioNodes();
    setIsSpeaking(false);
    setActiveSentenceIndex(null);
    setSentenceProgress(0);
    setPreviewingVoiceId(null);
  };

  const toggleSpeech = () => {
    if (isSpeaking) {
      stopSpeech();
    } else {
      startSpeech(activeSentenceIndex ?? 0);
    }
  };

  const handleUpdatePlaybackSpeed = (rawRate: number) => {
    const clampedRate = Math.round(Math.max(0.5, Math.min(2.0, rawRate)) * 100) / 100;
    settingsRef.current = { ...settingsRef.current, ttsRate: clampedRate };
    onUpdateSettings({ ttsRate: clampedRate });

    // Live-update HTML5 Audio playbackRate with preservesPitch=true (just like YouTube) without restarting audio
    if (activeAudioRef.current) {
      applyYoutubeStylePlaybackSpeed(activeAudioRef.current, clampedRate);
    } else if (isSpeaking) {
      startSpeech(activeSentenceIndex ?? 0, activeVoice, clampedRate);
    }
  };

  const handleSelectFemaleVoice = (voiceOption: FemaleVoiceOption) => {
    const targetSpeed = voiceOption.baseRate;
    settingsRef.current = {
      ...settingsRef.current,
      ttsVoiceId: voiceOption.id,
      ttsRate: targetSpeed
    };
    onUpdateSettings({
      ttsVoiceId: voiceOption.id,
      ttsRate: targetSpeed
    });

    if (isSpeaking) {
      startSpeech(activeSentenceIndex ?? 0, voiceOption, targetSpeed);
    }
  };

  const handlePreviewFemaleVoice = (voiceOption: FemaleVoiceOption, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetSpeed = voiceOption.baseRate;
    settingsRef.current = {
      ...settingsRef.current,
      ttsVoiceId: voiceOption.id,
      ttsRate: targetSpeed
    };
    onUpdateSettings({
      ttsVoiceId: voiceOption.id,
      ttsRate: targetSpeed
    });

    if (previewingVoiceId === voiceOption.id) {
      stopAudioNodes();
      setPreviewingVoiceId(null);
      return;
    }

    stopAudioNodes();
    setIsSpeaking(false);
    setActiveSentenceIndex(null);
    setPreviewingVoiceId(voiceOption.id);

    const sessionId = speechSessionRef.current;
    const sampleText =
      voiceOption.id === 'quynh-anh-4-0'
        ? 'Chào bạn, rất vui được làm quen với bạn, chúc bạn một ngày tốt lành và bình an.'
        : voiceOption.id === 'nu-review-phim' || voiceOption.id === 'nu-kich-tinh'
        ? `Chào bạn, đây là giọng Quỳnh Anh chuyên thể loại review phim, phim Trung, truyện tranh và audio với tốc độ ${targetSpeed}x mượt mà.`
        : `Chào bạn, rất vui được làm quen với bạn, bạn đang nghe ${voiceOption.name} tại Mạc Thư Các.`;

    playFemaleVoiceSegment(
      sampleText,
      voiceOption,
      targetSpeed,
      sessionId,
      () => {
        setPreviewingVoiceId(null);
      },
      () => {
        setPreviewingVoiceId(null);
      }
    );
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) {
        onSelectChapter(chapter.number - 1);
      } else if (e.key === 'ArrowRight' && hasNext) {
        onSelectChapter(chapter.number + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chapter.number, hasPrev, hasNext]);

  const getCanvasClasses = () => {
    if (settings.theme === 'dark') {
      return 'bg-[#0C0A09] text-[#E7E5E4]';
    }
    if (settings.theme === 'sepia') {
      return 'bg-[#F4EFE6] text-[#292524]';
    }
    return 'bg-[#FBF9F5] text-[#1C1917]';
  };

  const renderProgressiveHighlightedText = (text: string, isHighlighted: boolean) => {
    if (!isHighlighted) {
      return text;
    }

    const tokens = buildWeightedTokens(text);
    return tokens.map((token, tokenIdx) => {
      const isSpoken = sentenceProgress >= token.endRatio;
      const isCurrentWord =
        sentenceProgress >= token.startRatio && sentenceProgress < token.endRatio;
      const localWordPct = isCurrentWord
        ? Math.round(
            Math.min(
              100,
              Math.max(
                0,
                ((sentenceProgress - token.startRatio) /
                  Math.max(0.0001, token.endRatio - token.startRatio)) *
                  100
              )
            )
          )
        : isSpoken
        ? 100
        : 0;

      const isDark = settings.theme === 'dark';
      const activeSweepFill = isDark
        ? 'rgba(251, 191, 36, 0.28)'
        : 'rgba(217, 119, 6, 0.22)';
      const activeSweepRest = isDark
        ? 'rgba(251, 191, 36, 0.07)'
        : 'rgba(217, 119, 6, 0.06)';

      return (
        <React.Fragment key={tokenIdx}>
          <span
            className={`rounded-[3px] transition-colors duration-200 ease-out ${
              isCurrentWord
                ? 'text-amber-950 dark:text-amber-100 shadow-[0_1.5px_0_0_rgba(180,83,9,0.5)] dark:shadow-[0_1.5px_0_0_rgba(251,191,36,0.55)]'
                : isSpoken
                ? 'bg-amber-500/[0.15] dark:bg-amber-400/[0.16] text-stone-950 dark:text-stone-50'
                : 'opacity-80'
            }`}
            style={
              isCurrentWord
                ? {
                    backgroundImage: `linear-gradient(90deg, ${activeSweepFill} ${localWordPct}%, ${activeSweepRest} ${localWordPct}%)`
                  }
                : undefined
            }
          >
            {token.word}
          </span>
          {token.space}
        </React.Fragment>
      );
    });
  };

  return (
    <div className={`min-h-screen transition-colors duration-200 ${getCanvasClasses()}`}>
      {/* Ultra-slim top reading progress line */}
      <div className="fixed top-0 left-0 right-0 h-0.5 bg-stone-200/40 dark:bg-stone-800/50 z-40">
        <div
          className="h-full bg-amber-700 dark:bg-amber-500 transition-all duration-150"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* Minimalist Sticky Reader Header */}
      <header className="sticky top-0 z-30 h-12 px-4 md:px-8 border-b border-stone-200/70 dark:border-stone-800/70 backdrop-blur-md bg-inherit/90 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToCatalog}
          className="min-h-[40px] px-2 -ml-2 flex items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Thư viện</span>
        </button>

        <div className="text-center truncate max-w-sm sm:max-w-md">
          <p className="text-xs font-medium opacity-80 truncate">
            {novel.title} <span className="opacity-40 mx-1">/</span> Chương {chapter.number}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setShowChaptersDrawer(true)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg opacity-75 hover:opacity-100 hover:bg-stone-500/10 transition-all cursor-pointer"
            title="Mục lục chương"
            aria-label="Mục lục chương"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowSettingsDrawer(true)}
            className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-all cursor-pointer ${
              isSpeaking
                ? 'bg-amber-800/15 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 opacity-100'
                : 'opacity-75 hover:opacity-100 hover:bg-stone-500/10'
            }`}
            title="Giọng đọc nữ, tốc độ phát & cài đặt hiển thị"
            aria-label="Cài đặt đọc"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Compact Real-time New Chapter Released Alert inside Reader */}
      {newChapterAlert && newChapterAlert.novelId === novel.id && (
        <div className="max-w-2xl mx-auto mt-2 px-5">
          <div className="px-2.5 py-1 rounded-lg bg-amber-900/10 dark:bg-amber-500/10 border border-amber-800/20 dark:border-amber-500/20 flex items-center justify-between gap-2 text-[11px] overflow-hidden">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Bell className="w-3 h-3 text-amber-800 dark:text-amber-400 shrink-0" />
              <p className="font-medium truncate">
                Chương mới: C.{newChapterAlert.chapterNumber} — {newChapterAlert.title}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onSelectChapter(newChapterAlert.chapterNumber);
                  onDismissNewChapterAlert();
                }}
                className="px-2 py-0.5 rounded bg-amber-800 dark:bg-amber-600 text-white text-[10px] font-semibold hover:bg-amber-900 transition-colors whitespace-nowrap cursor-pointer"
              >
                Đọc ngay
              </button>
              <button
                type="button"
                onClick={onDismissNewChapterAlert}
                className="p-0.5 opacity-60 hover:opacity-100 cursor-pointer"
                aria-label="Đóng thông báo"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Focused Book Page Canvas */}
      <article className="max-w-[680px] mx-auto px-5 sm:px-8 pt-10 pb-36">
        {/* Clean Editorial Chapter Header */}
        <header className="pb-7 mb-8 border-b border-stone-300/60 dark:border-stone-800/80 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs opacity-60">
            <span>{novel.title}</span>
            <span aria-hidden="true">·</span>
            <span>{novel.author}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">{chapter.wordCount} chữ</span>
          </div>

          <h1
            ref={(el) => {
              activeParagraphRefs.current[0] = el;
            }}
            onClick={() => {
              if (isSpeaking) {
                startSpeech(0);
              }
            }}
            className={`relative font-display text-3xl sm:text-4xl font-bold mt-2.5 leading-tight text-balance transition-all duration-500 ease-out ${
              isSpeaking && activeSentenceIndex === 0
                ? 'bg-amber-500/[0.08] dark:bg-amber-400/[0.09] ring-1 ring-amber-700/20 dark:ring-amber-400/20 rounded-xl px-3.5 py-2.5 -mx-3.5 cursor-pointer'
                : isSpeaking
                ? 'cursor-pointer hover:opacity-95'
                : ''
            }`}
            style={{ letterSpacing: settings.theme === 'dark' ? '0.01em' : 'normal' }}
          >
            {renderProgressiveHighlightedText(
              `Chương ${chapter.number}: ${chapter.title}`,
              isSpeaking && activeSentenceIndex === 0
            )}
            {isSpeaking && activeSentenceIndex === 0 && (
              <span className="block mt-2 h-[2px] w-full rounded-full bg-amber-700/15 dark:bg-amber-400/15 overflow-hidden">
                <span
                  className="block h-full bg-amber-700/75 dark:bg-amber-400/80 transition-all duration-150 ease-linear rounded-full"
                  style={{ width: `${Math.round(sentenceProgress * 100)}%` }}
                />
              </span>
            )}
          </h1>
        </header>

        {/* Body Prose */}
        <div
          className={`space-y-6 ${
            settings.fontFamily === 'serif' ? 'font-serif-book' : 'font-sans-ui'
          }`}
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            letterSpacing: settings.theme === 'dark' ? '0.01em' : 'normal'
          }}
        >
          {chapter.content.map((paragraph, idx) => {
            const sentenceIdx = idx + 1;
            const isHighlighted = isSpeaking && activeSentenceIndex === sentenceIdx;
            const isPastParagraph =
              isSpeaking && activeSentenceIndex !== null && sentenceIdx < activeSentenceIndex;

            return (
              <p
                key={idx}
                ref={(el) => {
                  activeParagraphRefs.current[sentenceIdx] = el;
                }}
                onClick={() => {
                  if (isSpeaking) {
                    startSpeech(sentenceIdx);
                  }
                }}
                className={`relative transition-all duration-500 ease-out ${
                  idx === 0
                    ? 'first-letter:text-5xl first-letter:font-display first-letter:font-bold first-letter:float-left first-letter:mr-3 first-letter:leading-none'
                    : ''
                } ${
                  isHighlighted
                    ? 'bg-amber-500/[0.08] dark:bg-amber-400/[0.09] ring-1 ring-amber-700/20 dark:ring-amber-400/20 shadow-xs rounded-xl px-3.5 py-2.5 -mx-3.5 cursor-pointer'
                    : isPastParagraph
                    ? 'opacity-65 hover:opacity-95 cursor-pointer'
                    : isSpeaking
                    ? 'opacity-85 hover:opacity-100 cursor-pointer'
                    : ''
                }`}
              >
                {renderProgressiveHighlightedText(paragraph, isHighlighted)}
                {isHighlighted && (
                  <span className="block mt-2.5 h-[2px] w-full rounded-full bg-amber-700/15 dark:bg-amber-400/15 overflow-hidden clear-both">
                    <span
                      className="block h-full bg-amber-700/75 dark:bg-amber-400/80 transition-all duration-150 ease-linear rounded-full"
                      style={{ width: `${Math.round(sentenceProgress * 100)}%` }}
                    />
                  </span>
                )}
              </p>
            );
          })}
        </div>

        {/* Auto-Advance Countdown Banner */}
        {autoAdvanceCountdown !== null && (
          <div className="mt-10 p-4 rounded-xl border border-amber-700/30 bg-amber-900/5 dark:bg-amber-400/10 flex items-center justify-between">
            <span className="text-xs font-medium">
              Tự động qua Chương {chapter.number + 1} sau {autoAdvanceCountdown} giây...
            </span>
            <button
              type="button"
              onClick={() => {
                if (countdownTimerRef.current) {
                  window.clearInterval(countdownTimerRef.current);
                  countdownTimerRef.current = null;
                }
                setAutoAdvanceCountdown(null);
              }}
              className="px-3 py-1 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium cursor-pointer"
            >
              Dừng
            </button>
          </div>
        )}

        {/* Chapter Footer Navigation */}
        <div className="mt-14 pt-8 border-t border-stone-300/60 dark:border-stone-800/80 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => prevChapterNumber !== null && onSelectChapter(prevChapterNumber)}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-stone-300/80 dark:border-stone-800 text-xs font-medium flex items-center gap-1.5 disabled:opacity-35 hover:bg-stone-500/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Chương trước</span>
          </button>

          <button
            type="button"
            onClick={() => setShowChaptersDrawer(true)}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-stone-300/80 dark:border-stone-800 text-xs font-medium hover:bg-stone-500/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono-num"
          >
            {chapter.number} / {sortedChapters[sortedChapters.length - 1]?.number || sortedChapters.length}
          </button>

          {hasNext && nextChapterNumber !== null ? (
            <button
              type="button"
              onClick={() => onSelectChapter(nextChapterNumber)}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-medium flex items-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Chương tiếp</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : onFetchNextChapter ? (
            <button
              type="button"
              disabled={isFetchingNextChapter}
              onClick={async () => {
                const nextNum = await onFetchNextChapter();
                if (nextNum) {
                  onSelectChapter(nextNum);
                }
              }}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Quét và lấy chương mới tiếp theo"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetchingNextChapter ? 'animate-spin' : ''}`} />
              <span>{isFetchingNextChapter ? 'Đang lấy chương...' : 'Lấy chương mới'}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="min-h-[42px] px-4 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-950 text-xs font-medium flex items-center gap-1.5 opacity-35 whitespace-nowrap shrink-0 cursor-not-allowed"
            >
              <span>Chương tiếp</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </article>

      {/* Floating Control Dock at Bottom: Auto-Scroll on left, 3-Vertical-Sliders button at the end (containing Female Voice Reader + Playback Speed + Display settings) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-1.5rem)] max-w-md">
        <div className="w-full max-w-full px-2.5 py-1.5 rounded-2xl border border-stone-300/80 dark:border-stone-800 bg-[#FBF9F5]/95 dark:bg-stone-900/95 backdrop-blur-md shadow-lg flex items-center justify-between gap-1.5 overflow-hidden">
          {/* Auto-Scroll Play/Pause + Speed */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsAutoScrolling((prev) => !prev)}
              className={`min-h-[34px] px-2.5 rounded-xl text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isAutoScrolling
                  ? 'bg-amber-800 dark:bg-amber-600 text-white'
                  : 'hover:bg-stone-200/70 dark:hover:bg-stone-800 text-stone-800 dark:text-stone-200'
              }`}
            >
              {isAutoScrolling ? <Pause className="w-3.5 h-3.5 shrink-0" /> : <Play className="w-3.5 h-3.5 shrink-0" />}
              <span>{isAutoScrolling ? 'Dừng' : 'Tự cuộn'}</span>
            </button>

            <div className="flex items-center bg-stone-200/60 dark:bg-stone-800/80 rounded-lg px-0.5 py-0.5 shrink-0">
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ autoScrollSpeed: Math.max(1, settings.autoScrollSpeed - 1) })
                }
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-stone-300/60 dark:hover:bg-stone-700 text-xs font-mono-num cursor-pointer"
                title="Giảm tốc độ cuộn"
              >
                -
              </button>
              <span className="text-[10px] font-mono-num px-1 text-stone-700 dark:text-stone-300">
                {settings.autoScrollSpeed}x
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ autoScrollSpeed: Math.min(10, settings.autoScrollSpeed + 1) })
                }
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-stone-300/60 dark:hover:bg-stone-700 text-xs font-mono-num cursor-pointer"
                title="Tăng tốc độ cuộn"
              >
                +
              </button>
            </div>
          </div>

          <div className="h-4 w-px bg-stone-300 dark:bg-stone-800 shrink-0" />

          {/* Last Button (Nút 3 gạch dọc cuối cùng): Opens Voice Reader + Playback Speed + Display Settings */}
          <div className="flex items-center justify-end gap-1 min-w-0 flex-1 overflow-hidden">
            {isSpeaking && (
              <button
                type="button"
                onClick={stopSpeech}
                className="min-h-[34px] px-2 rounded-xl bg-amber-800 dark:bg-amber-600 text-white text-[11px] font-semibold flex items-center gap-1 min-w-0 shrink cursor-pointer overflow-hidden"
                title="Dừng đọc giọng nữ"
              >
                <VolumeX className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Dừng ({settings.ttsRate.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}x)
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowSettingsDrawer(true)}
              className={`min-h-[34px] px-2.5 rounded-xl text-[11px] font-medium flex items-center gap-1.5 min-w-0 overflow-hidden cursor-pointer transition-colors ${
                isSpeaking
                  ? 'bg-amber-900/15 dark:bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-700/30'
                  : 'hover:bg-stone-200/70 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'
              }`}
              title="Mở giọng đọc nữ, tốc độ phát & tùy chỉnh chữ"
            >
              <Sliders className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {isSpeaking ? 'Giọng đọc' : 'Giọng đọc & Cài đặt'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Chapter List Drawer */}
      {showChaptersDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[#FBF9F5] dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-800 gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-stone-900 dark:text-stone-100">
                  Mục Lục ({sortedChapters.length} chương)
                </h3>
                <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{novel.title}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {onFetchNextChapter && (
                  <button
                    type="button"
                    disabled={isFetchingNextChapter}
                    onClick={async () => {
                      const nextNum = await onFetchNextChapter();
                      if (nextNum) {
                        onSelectChapter(nextNum);
                        setShowChaptersDrawer(false);
                      }
                    }}
                    className="min-h-[34px] px-3 py-1.5 rounded-xl bg-amber-800/15 hover:bg-amber-800/25 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 border border-amber-700/30 text-amber-900 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isFetchingNextChapter ? 'animate-spin' : ''}`} />
                    <span>{isFetchingNextChapter ? 'Đang lấy...' : 'Lấy chương mới'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowChaptersDrawer(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto divide-y divide-stone-200/50 dark:divide-stone-800/70 p-2">
              {sortedChapters.map((chap) => {
                const isCurrent = chap.number === chapter.number;
                return (
                  <button
                    key={chap.id}
                    type="button"
                    onClick={() => {
                      onSelectChapter(chap.number);
                      setShowChaptersDrawer(false);
                    }}
                    className={`w-full min-h-[48px] px-4 py-2.5 rounded-xl text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-amber-900/10 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300 font-semibold'
                        : 'hover:bg-stone-200/50 dark:hover:bg-stone-800/50 text-stone-800 dark:text-stone-200'
                    }`}
                  >
                    <span className="text-sm truncate">
                      Chương {chap.number}: {chap.title}
                    </span>
                    <span className="text-xs font-mono-num text-stone-400 shrink-0">
                      {chap.wordCount} chữ
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3-Vertical-Sliders Drawer: Female Voice Player + Playback Speed + Page Settings */}
      {showSettingsDrawer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[#FBF9F5] dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-stone-200 dark:border-stone-800 shrink-0">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 truncate">
                  Giọng Đọc Nữ, Tốc Độ Phát & Trang Đọc
                </h3>
                <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                  Điều khiển nghe truyện, tốc độ phát và 6 giọng nữ chuyên biệt
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsDrawer(false)}
                className="min-h-[38px] min-w-[38px] shrink-0 flex items-center justify-center text-stone-500 hover:text-stone-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-5">
              {/* 1. VOICE PLAYBACK CONTROL & SPEED BAR INSIDE THE 3-SLIDERS DRAWER */}
              <div className="w-full max-w-full p-3.5 sm:p-4 rounded-2xl bg-amber-900/10 dark:bg-amber-500/10 border border-amber-800/25 dark:border-amber-500/25 space-y-3 overflow-hidden">
                <div className="flex items-center justify-between gap-2.5 min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                    <div className="w-9 h-9 rounded-full bg-emerald-500 text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
                      Q
                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100 truncate">
                        {activeVoice.name}
                      </p>
                      <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 truncate">
                        VI - Nữ · {settings.ttsRate}x · MP3
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={toggleSpeech}
                    className={`min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                      isSpeaking
                        ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                    }`}
                  >
                    {isSpeaking ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5 shrink-0" />
                        <span>Dừng đọc</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Phát giọng đọc</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 dark:bg-sky-400/10 border border-sky-500/20 text-[11px] text-sky-900 dark:text-sky-200 leading-snug truncate">
                  {activeVoice.description}
                </div>

                {/* PLAYBACK SPEED CONTROLS (TỐC ĐỘ PHÁT CHUẨN YOUTUBE) */}
                <div className="pt-3 border-t border-amber-800/15 dark:border-amber-500/20 space-y-2.5 min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5 truncate">
                        <Gauge className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
                        <span className="truncate">Tốc độ phát (Chuẩn YouTube)</span>
                      </span>
                      <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5 truncate">
                        Giữ nguyên tông giọng tự nhiên, không biến đổi giọng
                      </p>
                    </div>

                    <div className="flex items-center gap-0.5 bg-white/80 dark:bg-stone-950/80 border border-stone-300/80 dark:border-stone-800 rounded-lg px-1 py-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdatePlaybackSpeed(settings.ttsRate - 0.1)}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-stone-200 dark:hover:bg-stone-800 text-xs font-bold cursor-pointer"
                        title="Giảm tốc độ phát"
                      >
                        -
                      </button>
                      <span className="text-xs font-mono-num font-bold text-amber-800 dark:text-amber-400 px-1">
                        {settings.ttsRate.toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1')}x
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdatePlaybackSpeed(settings.ttsRate + 0.1)}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-stone-200 dark:hover:bg-stone-800 text-xs font-bold cursor-pointer"
                        title="Tăng tốc độ phát"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Quick Speed Preset Buttons (YouTube Presets) */}
                  <div className="grid grid-cols-7 gap-1 w-full min-w-0">
                    {PLAYBACK_SPEED_PRESETS.map((preset) => {
                      const isCurrentSpeed = Math.abs(settings.ttsRate - preset) < 0.04;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleUpdatePlaybackSpeed(preset)}
                          className={`min-w-0 px-0.5 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-mono-num font-semibold border transition-all cursor-pointer truncate text-center ${
                            isCurrentSpeed
                              ? 'bg-amber-800 dark:bg-amber-500 text-white dark:text-stone-950 border-amber-800 dark:border-amber-500'
                              : 'bg-white/70 dark:bg-stone-950/60 border-stone-300/80 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:border-amber-700/50'
                          }`}
                        >
                          {preset === 1.0 ? '1x' : `${preset}x`}
                        </button>
                      );
                    })}
                  </div>

                  {/* Fine-tuning Range Slider */}
                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={settings.ttsRate}
                    onChange={(e) => handleUpdatePlaybackSpeed(Number(e.target.value))}
                    className="w-full max-w-full block accent-amber-700 cursor-pointer"
                  />
                </div>
              </div>

              {/* 2. FEMALE VOICE SELECTOR SECTION */}
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400 flex items-center gap-1.5 min-w-0 truncate">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Chọn Giọng Đọc Nữ (6 Giọng Nữ)</span>
                  </label>
                  <span className="text-[11px] font-mono-num text-stone-500 dark:text-stone-400 shrink-0">
                    100% Giọng Nữ
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {FEMALE_VOICE_OPTIONS.map((voice) => {
                    const isSelected = activeVoice.id === voice.id;
                    const isPreviewing = previewingVoiceId === voice.id;

                    return (
                      <div
                        key={voice.id}
                        onClick={() => handleSelectFemaleVoice(voice)}
                        className={`min-w-0 overflow-hidden p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'border-amber-700 dark:border-amber-500 bg-amber-900/10 dark:bg-amber-500/15 shadow-xs'
                            : 'border-stone-200 dark:border-stone-800 bg-white/60 dark:bg-stone-950/60 hover:border-stone-300 dark:hover:border-stone-700'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center justify-between gap-1.5 min-w-0">
                            <span className="text-xs font-bold text-stone-900 dark:text-stone-100 truncate">
                              {voice.name}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-amber-800/15 dark:bg-amber-400/15 text-[10px] font-semibold text-amber-900 dark:text-amber-300">
                              {voice.badge}
                            </span>
                            <span className="text-[10px] font-mono-num text-stone-400">
                              Chuẩn {voice.baseRate}x
                            </span>
                          </div>

                          <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-snug line-clamp-2">
                            {voice.description}
                          </p>
                        </div>

                        <div className="pt-1 flex items-center justify-between gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => handlePreviewFemaleVoice(voice, e)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
                              isPreviewing
                                ? 'bg-amber-800 dark:bg-amber-600 text-white'
                                : 'bg-stone-200/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-300 dark:hover:bg-stone-700'
                            }`}
                          >
                            {isPreviewing ? (
                              <>
                                <VolumeX className="w-3 h-3 shrink-0" />
                                <span>Dừng thử</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3 h-3 shrink-0" />
                                <span>Nghe thử</span>
                              </>
                            )}
                          </button>

                          <span className="text-[10px] font-medium text-amber-800 dark:text-amber-400 truncate">
                            {isSelected ? 'Đang dùng' : 'Bấm để chọn'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. PAGE APPEARANCE & AUTO-SCROLL SETTINGS */}
              <div className="border-t border-stone-200 dark:border-stone-800 pt-4">
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-2">
                  Màu nền trang sách
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {(
                    [
                      { id: 'light', label: 'Giấy sáng', bg: 'bg-[#FBF9F5] text-stone-900 border-stone-300' },
                      { id: 'sepia', label: 'Cổ điển', bg: 'bg-[#F4EFE6] text-stone-900 border-amber-800/30' },
                      { id: 'dark', label: 'Đêm tối', bg: 'bg-[#0C0A09] text-stone-100 border-stone-700' }
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onUpdateSettings({ theme: item.id })}
                      className={`min-h-[40px] rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                        item.bg
                      } ${
                        settings.theme === item.id ? 'ring-2 ring-amber-700 dark:ring-amber-500 font-semibold' : ''
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-2">
                  Phông chữ
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ fontFamily: 'serif' })}
                    className={`min-h-[40px] rounded-xl border text-xs font-serif-book cursor-pointer ${
                      settings.fontFamily === 'serif'
                        ? 'border-amber-700 bg-amber-900/10 dark:bg-amber-500/15 text-stone-900 dark:text-white font-semibold'
                        : 'border-stone-300 dark:border-stone-800 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    Lora Serif (Sách in)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ fontFamily: 'sans' })}
                    className={`min-h-[40px] rounded-xl border text-xs font-sans-ui cursor-pointer ${
                      settings.fontFamily === 'sans'
                        ? 'border-amber-700 bg-amber-900/10 dark:bg-amber-500/15 text-stone-900 dark:text-white font-semibold'
                        : 'border-stone-300 dark:border-stone-800 text-stone-700 dark:text-stone-300'
                    }`}
                  >
                    Jakarta Sans (Hiện đại)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">
                    Cỡ chữ: <span className="font-mono-num">{settings.fontSize}px</span>
                  </label>
                  <input
                    type="range"
                    min={15}
                    max={26}
                    value={settings.fontSize}
                    onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                    className="w-full accent-amber-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1.5">
                    Tốc độ cuộn: <span className="font-mono-num">{settings.autoScrollSpeed}x</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={settings.autoScrollSpeed}
                    onChange={(e) => onUpdateSettings({ autoScrollSpeed: Number(e.target.value) })}
                    className="w-full accent-amber-700"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-stone-800 dark:text-stone-200">
                    Tự động chuyển chương kế tiếp
                  </p>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Chuyển chương khi cuộn hoặc đọc tới cuối trang
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ autoNextChapter: !settings.autoNextChapter })}
                  className={`min-h-[32px] px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    settings.autoNextChapter
                      ? 'bg-amber-800 dark:bg-amber-600 text-white'
                      : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {settings.autoNextChapter ? 'Đang bật' : 'Đang tắt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
