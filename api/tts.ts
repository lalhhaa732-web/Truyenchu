import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const ttsAudioCache = new Map<
  string,
  { buffer: Buffer; mimeType: string; voiceEngine: 'neural' | 'fallback' }
>();
const ttsChunkCache = new Map<string, Buffer>();

function normalizeVietnameseTtsText(raw: string): string {
  if (!raw) return '';
  let text = raw
    .replace(/^[*\-=~_•▪►◊+\s]+$/gm, ' ')
    .replace(/[*#_~^=|\\<>]+/g, ' ')
    .replace(/\[([^\]]+)\]/g, ' $1 ')
    .replace(/【([^】]+)】/g, ' $1 ')
    .replace(/《([^》]+)》/g, ' $1 ')
    .replace(/\(([^)]+)\)/g, ' $1 ')
    .replace(/\bC\.(\d+)\b/gi, 'Chương $1')
    .replace(/\bQ\.(\d+)\b/gi, 'Quyển $1')
    .replace(/\bv\.v\.+/gi, 'vân vân')
    .replace(/\bko\b/gi, 'không')
    .replace(/\bđc\b/gi, 'được')
    .replace(/\b(\d{1,3})\.(\d{3})(?:\.(\d{3}))?\b/g, (_m, a, b, c) =>
      c ? `${a}${b}${c}` : `${a}${b}`
    )
    .replace(/(?:^|\n)\s*[-–—―]+\s*/g, ' ')
    .replace(/(?<=\p{L})[-–](?=\p{L})/gu, ' ')
    .replace(/[—–―-]+/g, ' ')
    .replace(/[“”"«»„‟‹›'’‘`]/g, ' ')
    .replace(/\.{2,}|…+/g, ' ')
    .replace(/[;:]+/g, ' ')
    .replace(/[!?]+/g, '.')
    .replace(/(?:^|(?<=[.,]))\s*([^\s.,]{1,14}(?:\s+[^\s.,]{1,14}){0,3}),\s*/g, ' $1 ')
    .replace(/,\s*/g, (_match, offset, fullStr) => {
      const before = fullStr.slice(Math.max(0, offset - 36), offset);
      return before.includes(',') || before.includes('.') || before.trim().length < 32 ? ' ' : ', ';
    })
    .replace(/\.(?=[^\d]|$)/g, (_match, offset, fullStr) => {
      const before = fullStr.slice(Math.max(0, offset - 26), offset);
      return before.includes(',') || before.trim().length < 22 ? ' ' : ', ';
    })
    .replace(/,\s*,+/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,(?=[^\s])/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/^[,.;:!?\s]+/, '').replace(/[,.;:!?\s]+$/, '').trim();
  return text;
}

function getQuynhAnhProsodyForVoice(voiceId?: string): { pitch: string; rate: string } {
  switch (voiceId) {
    case 'ngoc-huyen-ha-noi':
      return { pitch: '-18Hz', rate: '-4%' };
    case 'hoai-my-neural':
      return { pitch: '+0Hz', rate: '+5%' };
    case 'quynh-anh-4-0':
    default:
      return { pitch: '+18Hz', rate: '+12%' };
  }
}

function stripMp3Id3Header(buf: Buffer): Buffer {
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    const headerEnd = 10 + size;
    if (headerEnd < buf.length) {
      return buf.subarray(headerEnd);
    }
  }
  return buf;
}

async function synthesizeQuynhAnhNeuralMp3(cleanText: string, voiceId?: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const synthesisPromise = (async () => {
      await tts.setMetadata(
        'vi-VN-HoaiMyNeural',
        OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
      );
      const prosody = getQuynhAnhProsodyForVoice(voiceId);
      const { audioStream } = tts.toStream(cleanText, prosody);
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        chunks.push(Buffer.from(chunk));
      }
      const combined = Buffer.concat(chunks);
      if (combined.length < 256) {
        throw new Error('Neural TTS returned empty buffer');
      }
      return combined;
    })();

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Neural TTS timeout')), 6500);
    });

    return await Promise.race([synthesisPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try {
      tts.close();
    } catch {
      // ignore
    }
  }
}

function splitIntoNaturalVietnameseClauses(cleanText: string, maxLen = 195): string[] {
  if (cleanText.length <= maxLen) {
    return [cleanText.replace(/[,.;:!?\s]+$/, '').trim()].filter(Boolean);
  }

  const parts = cleanText
    .split(/(?<=[,.?!;:])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const clauses: string[] = [];
  let currentClause = '';

  for (const part of parts) {
    if (!currentClause) {
      if (part.length <= maxLen) {
        currentClause = part;
      } else {
        const words = part.split(' ');
        let wordChunk = '';
        for (const w of words) {
          if ((wordChunk + ' ' + w).trim().length <= maxLen) {
            wordChunk = (wordChunk + ' ' + w).trim();
          } else {
            if (wordChunk) clauses.push(wordChunk.replace(/[,.;:!?\s]+$/, '').trim());
            wordChunk = w.slice(0, maxLen);
          }
        }
        currentClause = wordChunk;
      }
    } else if (currentClause.length + 1 + part.length <= maxLen) {
      currentClause = `${currentClause} ${part}`;
    } else {
      clauses.push(currentClause.replace(/[,.;:!?\s]+$/, '').trim());
      currentClause = part;
    }
  }

  if (currentClause) {
    clauses.push(currentClause.replace(/[,.;:!?\s]+$/, '').trim());
  }

  return clauses.filter(Boolean);
}

async function fetchSingleTtsChunk(chunk: string): Promise<Buffer> {
  const cached = ttsChunkCache.get(chunk);
  if (cached) return cached;

  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&ttsspeed=1&q=${encodeURIComponent(
    chunk
  )}`;
  const response = await fetch(ttsUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    }
  });
  if (!response.ok) {
    throw new Error(`TTS upstream status ${response.status}`);
  }
  const arrBuf = await response.arrayBuffer();
  const buf = Buffer.from(arrBuf);
  if (ttsChunkCache.size > 300) {
    const firstKey = ttsChunkCache.keys().next().value;
    if (firstKey) ttsChunkCache.delete(firstKey);
  }
  ttsChunkCache.set(chunk, buf);
  return buf;
}

export default async function handler(
  req: { method?: string; body?: { text?: string; voiceId?: string } | string },
  res: {
    status: (code: number) => { json: (data: unknown) => void };
    json?: (data: unknown) => void;
  }
) {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let parsedBody: { text?: string; voiceId?: string } = {};
  if (typeof req.body === 'string') {
    try {
      parsedBody = JSON.parse(req.body);
    } catch {
      parsedBody = {};
    }
  } else if (req.body && typeof req.body === 'object') {
    parsedBody = req.body;
  }

  const cleanText = normalizeVietnameseTtsText(parsedBody.text || '');
  if (!cleanText) {
    res.status(400).json({ error: 'Empty text' });
    return;
  }

  const activeVoiceId = parsedBody.voiceId || 'quynh-anh-4-0';
  const cacheKey = `${activeVoiceId}::${cleanText}`;
  const cachedAudio = ttsAudioCache.get(cacheKey);
  if (cachedAudio) {
    res.status(200).json({
      audioBase64: cachedAudio.buffer.toString('base64'),
      mimeType: cachedAudio.mimeType,
      voiceEngine: cachedAudio.voiceEngine
    });
    return;
  }

  try {
    const neuralMp3Buffer = await synthesizeQuynhAnhNeuralMp3(cleanText, activeVoiceId);
    if (ttsAudioCache.size > 200) {
      const oldestKey = ttsAudioCache.keys().next().value;
      if (oldestKey) ttsAudioCache.delete(oldestKey);
    }
    ttsAudioCache.set(cacheKey, {
      buffer: neuralMp3Buffer,
      mimeType: 'audio/mpeg',
      voiceEngine: 'neural'
    });
    res.status(200).json({
      audioBase64: neuralMp3Buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      voiceEngine: 'neural'
    });
    return;
  } catch {
    // Fallback to clause-split MP3
  }

  const chunks = splitIntoNaturalVietnameseClauses(cleanText, 195).slice(0, 16);
  try {
    const rawBuffers = await Promise.all(chunks.map((chunk) => fetchSingleTtsChunk(chunk)));
    const cleanedBuffers = rawBuffers.map((buf, idx) =>
      idx === 0 ? buf : stripMp3Id3Header(buf)
    );
    const combined = Buffer.concat(cleanedBuffers);
    ttsAudioCache.set(cacheKey, {
      buffer: combined,
      mimeType: 'audio/mpeg',
      voiceEngine: 'fallback'
    });
    res.status(200).json({
      audioBase64: combined.toString('base64'),
      mimeType: 'audio/mpeg',
      voiceEngine: 'fallback'
    });
  } catch {
    res.status(502).json({ error: 'TTS stream unavailable' });
  }
}
