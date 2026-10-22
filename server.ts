import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { GoogleGenAI } from '@google/genai';
import { INITIAL_NOVELS, AUTO_CHAPTER_POOL } from './src/data/seedNovels.ts';
import { Novel, Chapter, RealtimeUpdateEvent } from './src/types.ts';

const PORT = 3000;

function countWords(paragraphs: string[]): number {
  return paragraphs.reduce((acc, p) => acc + p.trim().split(/\s+/).length, 0);
}

// Server-authoritative state
const novelsState: Novel[] = JSON.parse(JSON.stringify(INITIAL_NOVELS));
const recentEvents: RealtimeUpdateEvent[] = [];

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&lsquo;|&rsquo;|&#8216;|&#8217;|&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&hellip;|&#8230;/gi, '…')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function parseChapterNumberFromText(raw: string): number | null {
  const m =
    raw.match(/(?:chương|chap|chapter|hồi)\s*0*(\d+)/i) ||
    raw.match(/(?:chuong|chap|chapter)-0*(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isNavigationOnlyLabel(raw: string): boolean {
  const clean = stripTags(raw).trim().toLowerCase();
  if (!clean) return true;
  return /^(?:chương\s*(?:tiếp|sau|kế|tiếp\s*theo|trước|mới\s*nhất|đầu)|chap\s*(?:tiếp|sau|trước|đầu)|next\s*chapter|prev(?:ious)?\s*chapter|đọc\s*(?:từ\s*đầu|tiếp|ngay)|mục\s*lục|danh\s*sách\s*chương|trang\s*chủ|bỏ\s*qua\s*điều\s*hướng|theo\s*dõi\s*qua\s*rss)$/i.test(
    clean
  );
}

function cleanNovelTitleText(rawTitle: string): string {
  return stripTags(rawTitle)
    .replace(
      /\s*[-|_–—]\s*(Storya|TruyenFull|Metruyenchu|Tangthuvien|Wattpad|Wikidich|Sangtacviet|DocTruyen|TruyenYY|TruyenQQ|NetTruyen|TruyenChu|DTruyen|SStruyen).*$/i,
      ''
    )
    .replace(/\s*\[(?:Tới\s*)?(?:Chương|Chap)\s*\d+[^\]]*\]/gi, '')
    .replace(/\s*\bFull\s*\(Hoàn\s*Thành\)/gi, '')
    .replace(/\s*\((?:Hoàn\s*Thành|Đang\s*ra|Full)\)/gi, '')
    .replace(/\s+(?:Chương|Chap|Chapter|Hồi)\s*\d+\s*[:.\-–—][\s\S]*$/i, '')
    .trim();
}

function cleanChapterTitleText(rawTitle: string, fallbackNumber?: number): string {
  let cleaned = stripTags(rawTitle)
    .replace(
      /\s*[-|_–—]\s*(Storya|TruyenFull|Metruyenchu|Tangthuvien|Wattpad|Wikidich|Sangtacviet|DocTruyen|TruyenYY|TruyenQQ|NetTruyen|TruyenChu|DTruyen|SStruyen).*$/i,
      ''
    )
    .trim();

  // Strip trailing view count / date metadata from TOC rows (e.g. "1566 Nghênh đón ... 891 891 lượt đọc 12/10/2026")
  cleaned = cleaned
    .replace(/\s+\d[\d.,]*\s*(?:\d[\d.,]*\s*)?lượt\s*(?:đọc|xem)(?:\s+\d{1,2}\/\d{1,2}\/\d{2,4})?$/i, '')
    .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}$/i, '')
    .trim();

  // If title includes "<Novel Name> Chương X: <Chapter Name>", extract the part after Chương X
  const embeddedChapMatch = cleaned.match(
    /^.+?\b(?:chương|chap|chapter|hồi)\s*\d+\s*[:.\-–—]\s*(.+)$/i
  );
  if (embeddedChapMatch && embeddedChapMatch[1].trim()) {
    cleaned = embeddedChapMatch[1].trim();
  }

  cleaned = cleaned.replace(/^quyển\s*\d+\s*[:.\-–—]?\s*/i, '').trim();
  cleaned = cleaned.replace(/^(?:chương|chap|chapter|hồi)\s*\d+\s*[:.\-–—]?\s*/i, '').trim();
  cleaned = cleaned.replace(/^\d+\s*[:.\-–—]\s*/, '').trim();
  cleaned = cleaned.replace(/^(\d+)\s+(?=[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ])/u, '').trim();

  if (!cleaned || isNavigationOnlyLabel(cleaned)) {
    return fallbackNumber ? `Chương ${fallbackNumber}` : 'Khởi đầu hành trình';
  }
  return cleaned;
}

function isNoiseParagraph(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();

  // Filter out pure chapter numbers or reading time / view count stats
  if (/^(?:chương|chap|chapter|hồi)\s*\d+$/i.test(trimmed)) return true;
  if (/lượt\s*đọc\s*chương|lượt\s*đọc\s*truyện/i.test(lower)) return true;
  if (/đọc\s*chương\s*này\s*khoảng\s*\d+\s*phút/i.test(lower)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}\s*·/i.test(trimmed)) return true;

  const noisePatterns = [
    /cookie/i,
    /bản quyền thuộc về/i,
    /all rights reserved/i,
    /quảng cáo/i,
    /bấm vào đây để/i,
    /đăng nhập để bình luận/i,
    /báo lỗi chương/i,
    /chương trước\s*chương(?: tiếp| sau)/i,
    /truyện được cập nhật tại/i,
    /nguồn truyện:\s*http/i,
    /^bỏ qua điều hướng$/i,
    /^tiếng việt\s*\/\s*truyện/i
  ];
  return noisePatterns.some((re) => re.test(lower));
}

function splitLongParagraphIntoReadableChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= 750) return [trimmed];

  const sentences = trimmed.split(
    /(?<=[.!?…])\s+(?=[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ"“‘-])/
  );
  if (sentences.length <= 1) return [trimmed];

  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (!current) {
      current = s;
    } else if (current.length + 1 + s.length <= 520) {
      current = `${current} ${s}`;
    } else {
      chunks.push(current.trim());
      current = s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function extractParagraphsFromHtmlBlock(blockHtml: string, allowShortDialogue = false): string[] {
  const withoutScripts = blockHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(
      /<(?:nav|header|footer|aside|form|iframe|svg|button|select)[\s\S]*?<\/(?:nav|header|footer|aside|form|iframe|svg|button|select)>/gi,
      ''
    )
    .replace(/<!--[\s\S]*?-->/g, '');

  const normalizedLines = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])>/gi, '\n')
    .split(/\n+/);

  const paragraphs: string[] = [];
  const minLen = allowShortDialogue ? 2 : 16;

  for (const rawLine of normalizedLines) {
    const cleaned = stripTags(rawLine);
    if (!cleaned || isNoiseParagraph(cleaned)) continue;

    const subChunks = splitLongParagraphIntoReadableChunks(cleaned);
    for (const chunk of subChunks) {
      if (chunk.length >= minLen) {
        // Avoid consecutive identical lines while preserving repeated dialogue like "Ừm!" later in the chapter
        if (paragraphs[paragraphs.length - 1] !== chunk) {
          paragraphs.push(chunk);
        }
      }
      if (paragraphs.length >= 260) break;
    }
    if (paragraphs.length >= 260) break;
  }

  return paragraphs;
}

function extractMainStoryParagraphs(fullHtml: string): string[] {
  const dedicatedPatterns: RegExp[] = [
    /<div[^>]+(?:id|class)=["'][^"']*(?:reader-content|chapter-c|chapter-content|vungdoc|box-chap|js-truyenkk-read-content|truyen-content|reading-content|content-chapter|chapter_content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi
  ];

  let bestParagraphs: string[] = [];
  let bestWordCount = 0;

  for (const pattern of dedicatedPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(fullHtml)) !== null) {
      const candidateParagraphs = extractParagraphsFromHtmlBlock(m[1], true);
      const candidateWords = countWords(candidateParagraphs);
      if (candidateWords > bestWordCount && candidateParagraphs.length >= 3) {
        bestParagraphs = candidateParagraphs;
        bestWordCount = candidateWords;
      }
    }
    if (bestWordCount >= 220) {
      return bestParagraphs;
    }
  }

  const divRegex = /<div[^>]*>([\s\S]{400,80000}?)<\/div>/gi;
  let divMatch: RegExpExecArray | null;
  while ((divMatch = divRegex.exec(fullHtml)) !== null) {
    const candidateParagraphs = extractParagraphsFromHtmlBlock(divMatch[1], false);
    const candidateWords = countWords(candidateParagraphs);
    if (candidateWords > bestWordCount && candidateParagraphs.length >= 3) {
      bestParagraphs = candidateParagraphs;
      bestWordCount = candidateWords;
    }
  }

  if (bestParagraphs.length >= 3 && bestWordCount >= 180) {
    return bestParagraphs;
  }

  return [];
}

function mapExtractedGenre(rawGenres: string[]): string {
  const joined = rawGenres.join(' ').toLowerCase();
  if (joined.includes('tiên hiệp') || joined.includes('tu chân')) return 'Tiên Hiệp';
  if (joined.includes('huyền huyễn') || joined.includes('dị giới') || joined.includes('xuyên không') || joined.includes('trọng sinh')) {
    return 'Huyền Huyễn';
  }
  if (joined.includes('kiếm hiệp') || joined.includes('võ hiệp')) return 'Kiếm Hiệp';
  if (joined.includes('đô thị') || joined.includes('hiện đại') || joined.includes('ngôn tình')) return 'Đô Thị';
  if (joined.includes('khoa huyễn') || joined.includes('mạt thế') || joined.includes('võng du')) return 'Khoa Huyễn';
  if (joined.includes('cổ đại') || joined.includes('kỳ ảo') || joined.includes('dã sử')) return 'Kỳ Ảo Cổ Phong';
  return rawGenres[0]?.trim() || 'Huyền Huyễn';
}

interface ExtractedUrlData {
  title: string;
  chapterTitle?: string;
  detectedChapterNumber?: number;
  author: string;
  genre: string;
  synopsis: string;
  coverImageUrl?: string;
  parentBookUrl?: string;
  firstChapterUrl?: string;
  paragraphs: string[];
  chapterLinks: { title: string; url: string; number?: number }[];
  nextChapterUrl?: string;
  nextChapterTitle?: string;
}

async function fetchAndExtractUrl(rawUrl: string, allowParentBookLookup = true): Promise<ExtractedUrlData> {
  const parsedUrl = new URL(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    // 1. Check if RSS / Atom XML feed
    if (
      contentType.includes('xml') ||
      text.trim().startsWith('<?xml') ||
      text.includes('<rss') ||
      text.includes('<feed')
    ) {
      const channelTitleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const feedTitle = channelTitleMatch
        ? cleanNovelTitleText(channelTitleMatch[1])
        : parsedUrl.hostname;
      const itemRegex = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi;
      const items = text.match(itemRegex) || [];

      const chapterLinks: { title: string; url: string; number?: number }[] = [];
      let firstItemParagraphs: string[] = [];
      let firstItemTitle = '';

      const orderedItems = [...items].reverse();

      orderedItems.slice(0, 50).forEach((itemXml, idx) => {
        const tMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const lMatch =
          itemXml.match(/<link[^>]+href=["']([^"']+)["']/i) ||
          itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
        const descMatch = itemXml.match(
          /<(?:content:encoded|description|content|summary)[^>]*>([\s\S]*?)<\/(?:content:encoded|description|content|summary)>/i
        );

        const rawItemTitle = tMatch ? stripTags(tMatch[1]) : `Chương ${idx + 1}`;
        const rawItemLink = lMatch ? stripTags(lMatch[1]).trim() : parsedUrl.toString();
        let resolvedLink = parsedUrl.toString();
        try {
          resolvedLink = new URL(rawItemLink, parsedUrl.href).toString();
        } catch {
          // ignore
        }

        const chapNum = parseChapterNumberFromText(rawItemTitle) || idx + 1;

        if (idx === 0 && descMatch) {
          firstItemTitle = cleanChapterTitleText(rawItemTitle, chapNum);
          const extractedDescParagraphs = extractParagraphsFromHtmlBlock(
            decodeHtmlEntities(descMatch[1]),
            true
          );
          if (extractedDescParagraphs.length >= 2) {
            firstItemParagraphs = extractedDescParagraphs;
          } else {
            const rawDesc = stripTags(descMatch[1]);
            if (rawDesc.length > 40) {
              firstItemParagraphs = splitLongParagraphIntoReadableChunks(rawDesc);
            }
          }
        } else {
          chapterLinks.push({
            title: cleanChapterTitleText(rawItemTitle, chapNum),
            url: resolvedLink,
            number: chapNum
          });
        }
      });

      return {
        title: feedTitle,
        chapterTitle: firstItemTitle || undefined,
        author: parsedUrl.hostname.replace(/^www\./, ''),
        genre: 'Tiên Hiệp',
        synopsis: `Truyện được đồng bộ tự động qua nguồn RSS/Web từ ${parsedUrl.hostname}.`,
        paragraphs: firstItemParagraphs,
        chapterLinks,
        nextChapterUrl: chapterLinks[0]?.url,
        nextChapterTitle: chapterLinks[0]?.title
      };
    }

    // 2. Parse JSON-LD structured data (<script type="application/ld+json">) if available
    let ldBookName = '';
    let ldBookUrl = '';
    let ldBookDesc = '';
    let ldBookImage = '';
    let ldBookAuthor = '';
    const ldGenres: string[] = [];
    let ldChapterHeadline = '';
    let ldChapterPosition: number | undefined;

    const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldMatch: RegExpExecArray | null;
    while ((ldMatch = ldRegex.exec(text)) !== null) {
      try {
        const parsedLd = JSON.parse(ldMatch[1].trim());
        const nodes = Array.isArray(parsedLd)
          ? parsedLd
          : Array.isArray(parsedLd?.['@graph'])
          ? [parsedLd, ...parsedLd['@graph']]
          : [parsedLd];

        for (const node of nodes) {
          if (!node || typeof node !== 'object') continue;
          const nodeType = String(node['@type'] || '');

          if (/Book|Novel|CreativeWorkSeries/i.test(nodeType)) {
            if (typeof node.name === 'string' && node.name.trim()) {
              ldBookName = cleanNovelTitleText(node.name);
            }
            if (typeof node.url === 'string' && node.url.trim()) {
              ldBookUrl = new URL(node.url.trim(), parsedUrl.href).toString();
            }
            if (typeof node.description === 'string' && node.description.trim()) {
              ldBookDesc = stripTags(node.description);
            }
            if (typeof node.image === 'string' && node.image.trim()) {
              ldBookImage = new URL(node.image.trim(), parsedUrl.href).toString();
            } else if (Array.isArray(node.image) && typeof node.image[0] === 'string') {
              ldBookImage = new URL(node.image[0].trim(), parsedUrl.href).toString();
            }
            if (typeof node.author === 'string') {
              ldBookAuthor = node.author.trim();
            } else if (node.author && typeof node.author.name === 'string') {
              ldBookAuthor = node.author.name.trim();
            }
            if (Array.isArray(node.genre)) {
              for (const g of node.genre) {
                if (typeof g === 'string' && g.trim()) ldGenres.push(g.trim());
              }
            } else if (typeof node.genre === 'string' && node.genre.trim()) {
              ldGenres.push(node.genre.trim());
            }
          } else if (/Chapter/i.test(nodeType)) {
            if (typeof node.headline === 'string' && node.headline.trim()) {
              ldChapterHeadline = cleanChapterTitleText(node.headline);
            } else if (typeof node.name === 'string' && node.name.trim()) {
              ldChapterHeadline = cleanChapterTitleText(node.name);
            }
            if (typeof node.position === 'number' && node.position > 0) {
              ldChapterPosition = node.position;
            } else if (typeof node.position === 'string' && Number(node.position) > 0) {
              ldChapterPosition = Number(node.position);
            }
            if (node.isPartOf && typeof node.isPartOf === 'object') {
              if (typeof node.isPartOf.name === 'string' && !ldBookName) {
                ldBookName = cleanNovelTitleText(node.isPartOf.name);
              }
              if (typeof node.isPartOf.url === 'string' && !ldBookUrl) {
                ldBookUrl = new URL(node.isPartOf.url.trim(), parsedUrl.href).toString();
              }
            }
          }
        }
      } catch {
        // ignore malformed JSON-LD
      }
    }

    // 3. Standard HTML meta & heading parsing
    const ogTitle =
      text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      text.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      parsedUrl.hostname;

    const rawPageTitle = stripTags(ogTitle)
      .replace(
        /\s*[-|_–—]\s*(Storya|TruyenFull|Metruyenchu|Tangthuvien|Wattpad|Wikidich|Sangtacviet|DocTruyen|TruyenYY|TruyenQQ|NetTruyen).*$/i,
        ''
      )
      .trim();

    const chapterHeadingMatch =
      text.match(
        /<[^>]+class=["'][^"']*(?:chapter-title|truyen-title|chap-title)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
      ) ||
      text.match(/<h[12][^>]*>([\s\S]*?(?:chương|chap|chapter|hồi)\s*\d+[\s\S]*?)<\/h[12]>/i);

    const detectedChapterNumber =
      ldChapterPosition ||
      parseChapterNumberFromText(chapterHeadingMatch ? stripTags(chapterHeadingMatch[1]) : '') ||
      parseChapterNumberFromText(rawPageTitle) ||
      parseChapterNumberFromText(parsedUrl.pathname) ||
      undefined;

    let novelTitle = ldBookName || cleanNovelTitleText(rawPageTitle);
    let chapterTitle: string | undefined = ldChapterHeadline || undefined;

    if (!chapterTitle && chapterHeadingMatch) {
      chapterTitle = cleanChapterTitleText(chapterHeadingMatch[1], detectedChapterNumber);
    }

    // Split "<Novel Title> [-:] Chương X: <Chapter Title>" or "<Novel Title> Chương X: <Chapter Title>"
    const titleSplitMatch =
      rawPageTitle.match(
        /^(.*?)\s*[-–—:|]\s*((?:quyển\s*\d+\s*[-–—:|]\s*)?(?:chương|chap|chapter|hồi)\s*\d+.*)$/i
      ) ||
      rawPageTitle.match(
        /^(.+?)\s+((?:quyển\s*\d+\s*[-–—:|]?\s*)?(?:chương|chap|chapter|hồi)\s*\d+\s*[:.\-–—]?\s*.+)$/i
      );

    if (titleSplitMatch) {
      if (!ldBookName && titleSplitMatch[1].trim()) {
        novelTitle = cleanNovelTitleText(titleSplitMatch[1].trim()) || novelTitle;
      }
      if (!chapterTitle) {
        chapterTitle = cleanChapterTitleText(titleSplitMatch[2], detectedChapterNumber);
      }
    } else if (/^(?:chương|chap|chapter|hồi)\s*\d+/i.test(rawPageTitle)) {
      if (!chapterTitle) {
        chapterTitle = cleanChapterTitleText(rawPageTitle, detectedChapterNumber);
      }
    }

    const ogImageMatch =
      text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      text.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      '';
    let coverImageUrl = ldBookImage;
    if (!coverImageUrl && ogImageMatch) {
      try {
        coverImageUrl = new URL(stripTags(ogImageMatch), parsedUrl.href).toString();
      } catch {
        // ignore
      }
    }

    const ogDesc =
      text.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      '';

    // Extract author from JSON-LD, meta tags, or common Vietnamese novel page patterns
    let extractedAuthor =
      ldBookAuthor ||
      text.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      text.match(/(?:tác\s*giả|author)\s*[:：]?\s*<[^>]+>([^<]+)</i)?.[1] ||
      ogDesc.match(/tác\s*giả\s+([^,.|]+)/i)?.[1] ||
      '';
    extractedAuthor = stripTags(extractedAuthor).trim();
    if (!extractedAuthor || /^đang\s*cập\s*nhật$/i.test(extractedAuthor)) {
      extractedAuthor = parsedUrl.hostname.replace(/^www\./, '');
    }

    // Extract genre from JSON-LD, genre links, or meta description
    const genreMatchFromDesc = ogDesc.match(/thể\s*loại\s+([^.]+)/i)?.[1];
    if (genreMatchFromDesc && ldGenres.length === 0) {
      ldGenres.push(
        ...genreMatchFromDesc
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    }

    const paragraphs = extractMainStoryParagraphs(text);

    // 4. Scan anchor tags for First Chapter ("Đọc từ đầu"), Next Chapter ("Chương sau"), and TOC chapter links
    const chapterLinks: { title: string; url: string; number?: number }[] = [];
    const seenUrls = new Set<string>([parsedUrl.toString()]);
    let nextChapterUrl: string | undefined;
    let nextChapterTitle: string | undefined;
    let firstChapterUrl: string | undefined;

    const relNextMatch = text.match(/<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i);
    if (relNextMatch?.[1]) {
      try {
        const resolved = new URL(relNextMatch[1].trim(), parsedUrl.href).toString();
        if (resolved !== parsedUrl.toString()) {
          nextChapterUrl = resolved;
        }
      } catch {
        // ignore
      }
    }

    // Determine the base story path for matching child chapter URLs (e.g., "/vi/stories/nguoi-tren-van-nguoi")
    let storyBasePath = '';
    if (ldBookUrl) {
      try {
        storyBasePath = new URL(ldBookUrl).pathname.replace(/\/+$/, '');
      } catch {
        // ignore
      }
    } else if (paragraphs.length < 3) {
      storyBasePath = parsedUrl.pathname.replace(/\/+$/, '');
    }

    const anchorRegex = /<a\s+([^>]+)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRegex.exec(text)) !== null) {
      const attrs = match[1];
      const hrefMatch = attrs.match(/href=["']([^"'#]+)["']/i);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].trim();
      if (
        !href ||
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.endsWith('.xml') ||
        href.includes('?cpage=')
      ) {
        continue;
      }

      const anchorText = stripTags(match[2]);
      const titleAttr = attrs.match(/title=["']([^"']+)["']/i)?.[1] || '';
      const ariaLabel = attrs.match(/aria-label=["']([^"']+)["']/i)?.[1] || '';
      const idOrClass = `${attrs.match(/id=["']([^"']+)["']/i)?.[1] || ''} ${
        attrs.match(/class=["']([^"']+)["']/i)?.[1] || ''
      }`;

      let fullUrlObj: URL;
      try {
        fullUrlObj = new URL(href, parsedUrl.href);
      } catch {
        continue;
      }
      const fullUrl = fullUrlObj.toString();
      if (fullUrl === parsedUrl.toString()) continue;

      // Detect "Về trang truyện" / parent book link if not already set
      if (!ldBookUrl && /về\s*trang\s*truyện|danh\s*sách\s*chương|mục\s*lục/i.test(`${ariaLabel} ${titleAttr} ${anchorText}`)) {
        ldBookUrl = fullUrl;
      }

      // Detect "Đọc từ đầu" / "Đọc chương 1" button on Novel TOC pages
      if (
        !firstChapterUrl &&
        /^(?:đọc\s*từ\s*đầu|đọc\s*ngay|đọc\s*chương\s*1|bắt\s*đầu\s*đọc)$/i.test(
          anchorText.trim() || ariaLabel.trim()
        )
      ) {
        firstChapterUrl = fullUrl;
      }

      // Detect "Chương sau" / "Chương tiếp" button on Chapter pages
      const isNextButton =
        /\b(?:next_chap|next-chap|btn-next|chap-next)\b/i.test(idOrClass) ||
        /\brel=["']next["']/i.test(attrs) ||
        /^(?:chương\s*(?:tiếp|sau|kế|tiếp\s*theo)|chap\s*(?:tiếp|sau)|next\s*chapter|đọc\s*tiếp)\b/i.test(
          anchorText.trim() || ariaLabel.trim() || titleAttr.trim()
        );

      if (isNextButton && !/disabled/i.test(idOrClass)) {
        if (!nextChapterUrl) {
          nextChapterUrl = fullUrl;
          const candidateNextTitle = titleAttr || anchorText;
          if (candidateNextTitle && !isNavigationOnlyLabel(candidateNextTitle)) {
            nextChapterTitle = cleanChapterTitleText(candidateNextTitle);
          }
        }
        continue;
      }

      // Ignore "Chương mới nhất" / "Chương trước" navigation buttons when building sequential chapterLinks
      if (isNavigationOnlyLabel(anchorText || ariaLabel || titleAttr)) {
        continue;
      }

      const combinedLabel = anchorText || stripTags(titleAttr);
      const leadingNumMatch = combinedLabel.match(/^0*(\d{1,5})\s+\S+/);
      const chapNum =
        parseChapterNumberFromText(combinedLabel) ||
        (leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : null) ||
        parseChapterNumberFromText(href);

      const isChildOfStoryPath =
        Boolean(storyBasePath && storyBasePath.length > 4) &&
        fullUrlObj.pathname.startsWith(`${storyBasePath}/`) &&
        fullUrlObj.pathname.length > storyBasePath.length + 2;

      if (
        (combinedLabel.match(/^(?:chương|chap|chapter|quyển|hồi)\s*\d+/i) ||
          href.match(/(?:chuong|chap|chapter)-\d+/i) ||
          (isChildOfStoryPath && chapNum !== null)) &&
        combinedLabel.length > 2 &&
        combinedLabel.length < 180 &&
        !seenUrls.has(fullUrl)
      ) {
        seenUrls.add(fullUrl);
        chapterLinks.push({
          title: cleanChapterTitleText(combinedLabel, chapNum ?? undefined),
          url: fullUrl,
          number: chapNum ?? undefined
        });
      }

      if (chapterLinks.length >= 120) break;
    }

    // Sort numbered chapter links in ascending order (1, 2, 3...)
    chapterLinks.sort((a, b) => {
      if (a.number !== undefined && b.number !== undefined && a.number !== b.number) {
        return a.number - b.number;
      }
      return 0;
    });

    // If "Đọc từ đầu" (firstChapterUrl) was found on a TOC page, ensure it is at the front of chapterLinks as Chapter 1
    if (firstChapterUrl) {
      const existingIdx = chapterLinks.findIndex((l) => l.url === firstChapterUrl);
      if (existingIdx > 0) {
        const [firstItem] = chapterLinks.splice(existingIdx, 1);
        chapterLinks.unshift({ ...firstItem, number: 1 });
      } else if (existingIdx === -1) {
        chapterLinks.unshift({
          title: 'Chương 1',
          url: firstChapterUrl,
          number: 1
        });
      }
    }

    // If this is a Chapter page and we have a parentBookUrl (e.g., user pasted Chapter 1 URL directly),
    // optionally fetch parentBookUrl to enrich book synopsis, coverImageUrl, and genre!
    let finalSynopsis =
      ldBookDesc ||
      stripTags(ogDesc) ||
      `Đồng bộ trực tiếp từ nguồn ${parsedUrl.hostname}. Hệ thống tự động kiểm tra và lấy chương mới theo thời gian thực.`;

    if (
      allowParentBookLookup &&
      ldBookUrl &&
      ldBookUrl !== parsedUrl.toString() &&
      (!ldBookDesc || ldGenres.length === 0 || !coverImageUrl)
    ) {
      try {
        const parentData = await fetchAndExtractUrl(ldBookUrl, false);
        if (parentData.title && (!ldBookName || novelTitle.includes('Chương'))) {
          novelTitle = parentData.title;
        }
        if (parentData.synopsis && parentData.synopsis.length > finalSynopsis.length) {
          finalSynopsis = parentData.synopsis;
        }
        if (parentData.coverImageUrl && !coverImageUrl) {
          coverImageUrl = parentData.coverImageUrl;
        }
        if (parentData.genre && ldGenres.length === 0) {
          ldGenres.push(parentData.genre);
        }
        if (parentData.author && extractedAuthor === parsedUrl.hostname.replace(/^www\./, '')) {
          extractedAuthor = parentData.author;
        }
      } catch {
        // ignore parent lookup errors
      }
    }

    return {
      title: novelTitle || 'Tác Phẩm Nhập Từ URL',
      chapterTitle,
      detectedChapterNumber,
      author: extractedAuthor || parsedUrl.hostname.replace(/^www\./, ''),
      genre: mapExtractedGenre(ldGenres),
      synopsis: finalSynopsis,
      ...(coverImageUrl ? { coverImageUrl } : {}),
      ...(ldBookUrl ? { parentBookUrl: ldBookUrl } : {}),
      ...(firstChapterUrl ? { firstChapterUrl } : {}),
      paragraphs: paragraphs.slice(0, 260),
      chapterLinks: chapterLinks.slice(0, 80),
      nextChapterUrl,
      nextChapterTitle
    };
  } catch {
    const slugParts = parsedUrl.pathname
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]/g, ' ');
    const fallbackTitle = slugParts
      ? slugParts.charAt(0).toUpperCase() + slugParts.slice(1)
      : `Truyện từ ${parsedUrl.hostname}`;

    return {
      title: fallbackTitle,
      author: parsedUrl.hostname.replace(/^www\./, ''),
      genre: 'Tiên Hiệp',
      synopsis: `Tác phẩm được kết nối tự động qua địa chỉ ${rawUrl}. Máy chủ định kỳ kiểm tra và đồng bộ chương mới nhất.`,
      paragraphs: [],
      chapterLinks: []
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getNextChapterNumber(novel: Novel): number {
  if (!novel.chapters || novel.chapters.length === 0) return 1;
  const maxNum = novel.chapters.reduce((max, c) => Math.max(max, Number(c.number) || 0), 0);
  return Math.max(novel.chapters.length, maxNum) + 1;
}

function normalizeAndSortNovelChapters(novel: Novel): void {
  const byNumber = new Map<number, Chapter>();
  for (const ch of novel.chapters) {
    const num = Number(ch.number) || 1;
    if (!byNumber.has(num)) {
      byNumber.set(num, { ...ch, number: num });
    }
  }
  novel.chapters = Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
}

function buildCoherentGeneratedChapter(
  novel: Novel,
  chapterNumber: number,
  customTitle?: string
): { title: string; paragraphs: string[] } {
  const rawPool = AUTO_CHAPTER_POOL[novel.id];
  const poolTitles = Array.isArray(rawPool?.titles) ? rawPool.titles : [];
  const poolParagraphs = Array.isArray(rawPool?.paragraphs) ? rawPool.paragraphs : [];
  const existingTitles = new Set((novel.chapters || []).map((c) => c.title.toLowerCase().trim()));

  let title = customTitle ? cleanChapterTitleText(customTitle, chapterNumber) : '';
  if (!title) {
    const unusedPoolTitle = poolTitles.find((t) => !existingTitles.has(t.toLowerCase().trim()));
    if (unusedPoolTitle) {
      title = unusedPoolTitle;
    } else {
      const baseTitle =
        poolTitles.length > 0
          ? poolTitles[(chapterNumber - 1) % poolTitles.length]
          : 'Phong Vân Chuyển Dịch';
      const cycle = Math.floor((chapterNumber - 1) / Math.max(1, poolTitles.length)) + 1;
      const suffixes = ['Khởi Biến', 'Thiên Cơ', 'Phá Cục', 'Truyền Thừa', 'Quy Chân', 'Định Đạo'];
      title = `${baseTitle} · ${suffixes[(cycle + chapterNumber) % suffixes.length]}`;
    }
  }

  const primaryBlock =
    poolParagraphs.length > 0
      ? poolParagraphs[(chapterNumber - 1) % poolParagraphs.length] || []
      : [];
  const secondaryBlock =
    poolParagraphs.length > 0 ? poolParagraphs[chapterNumber % poolParagraphs.length] || [] : [];
  const prevChapter = novel.chapters[novel.chapters.length - 1];

  const introParagraph = prevChapter
    ? `Tiếp nối dư âm từ hồi "${prevChapter.title}", bầu không khí tại thế giới "${novel.title}" càng thêm phần ngưng trọng. Những biến chuyển âm thầm tích tụ suốt chặng đường qua bắt đầu hội tụ thành một luồng đại thế không thể đảo ngược.`
    : `Giữa thiên địa mênh mông của "${novel.title}", một luồng khí cơ cổ xưa vừa thức giấc, mở ra biến số mới trên con đường tu hành đầy hiểm trở.`;

  const closingParagraph = `Khi ánh tà dương dần khuất sau rặng núi xa, dư chấn của cuộc đối đầu tại chương ${chapterNumber} vẫn còn vang vọng mãi. Thế cục trước mắt đã mở ra một hướng rẽ hoàn toàn mới, buộc mỗi người trong cuộc phải đưa ra lựa chọn sinh tử ở chặng đường kế tiếp.`;

  const combined = [
    introParagraph,
    ...primaryBlock,
    ...(secondaryBlock !== primaryBlock ? secondaryBlock.slice(0, 2) : []),
    closingParagraph
  ].filter((p) => p && p.trim().length > 0);

  return { title, paragraphs: combined };
}

function generateNextChapterForNovel(
  novel: Novel,
  customTitle?: string,
  customParagraphs?: string[],
  sourceChapterUrl?: string
): Chapter {
  normalizeAndSortNovelChapters(novel);
  const nextNumber = getNextChapterNumber(novel);

  const validCustomParagraphs = Array.isArray(customParagraphs)
    ? customParagraphs.filter((p) => p && p.trim().length > 0)
    : [];

  const generated =
    validCustomParagraphs.length > 0 && customTitle
      ? null
      : buildCoherentGeneratedChapter(novel, nextNumber, customTitle);

  const title = customTitle
    ? cleanChapterTitleText(customTitle, nextNumber)
    : generated?.title || `Chương ${nextNumber}`;

  const content =
    validCustomParagraphs.length > 0
      ? validCustomParagraphs
      : generated?.paragraphs || [
          `Nội dung chương ${nextNumber} của "${novel.title}" đang được cập nhật.`
        ];

  const nowIso = new Date().toISOString();

  const newChapter: Chapter = {
    id: `${novel.id}-c${nextNumber}-${Date.now()}`,
    novelId: novel.id,
    number: nextNumber,
    title,
    content,
    wordCount: countWords(content),
    publishedAt: nowIso,
    ...(sourceChapterUrl ? { sourceChapterUrl } : {})
  };

  novel.chapters.push(newChapter);
  normalizeAndSortNovelChapters(novel);
  novel.updatedAt = nowIso;
  if (novel.sourceUrl || sourceChapterUrl) {
    novel.lastSyncedAt = nowIso;
  }
  novel.views += Math.floor(Math.random() * 150) + 40;

  return newChapter;
}

async function syncNovelFromSourceUrl(novel: Novel): Promise<Chapter> {
  normalizeAndSortNovelChapters(novel);
  const existingUrls = new Set(
    novel.chapters.map((c) => c.sourceChapterUrl).filter((u): u is string => Boolean(u))
  );

  if (novel.pendingChapterLinks && novel.pendingChapterLinks.length > 0) {
    novel.pendingChapterLinks = novel.pendingChapterLinks.filter((l) => !existingUrls.has(l.url));
  }

  // 1. If there are queued pending chapter links, fetch the next one in order
  while (novel.pendingChapterLinks && novel.pendingChapterLinks.length > 0) {
    const nextLink = novel.pendingChapterLinks.shift()!;
    if (existingUrls.has(nextLink.url)) continue;

    const extracted = await fetchAndExtractUrl(nextLink.url, false);
    const extractedParagraphs = Array.isArray(extracted?.paragraphs) ? extracted.paragraphs : [];

    if (
      extracted.nextChapterUrl &&
      !existingUrls.has(extracted.nextChapterUrl) &&
      !novel.pendingChapterLinks.some((l) => l.url === extracted.nextChapterUrl)
    ) {
      novel.pendingChapterLinks.unshift({
        title:
          extracted.nextChapterTitle && !isNavigationOnlyLabel(extracted.nextChapterTitle)
            ? extracted.nextChapterTitle
            : `Chương ${getNextChapterNumber(novel) + 1}`,
        url: extracted.nextChapterUrl
      });
    }

    const nextNum = getNextChapterNumber(novel);
    const candidateTitle =
      extracted.chapterTitle ||
      (!isNavigationOnlyLabel(nextLink.title) ? nextLink.title : '') ||
      `Chương ${nextNum}`;
    const resolvedTitle = cleanChapterTitleText(candidateTitle, nextNum);

    return generateNextChapterForNovel(
      novel,
      resolvedTitle,
      extractedParagraphs.length >= 2 ? extractedParagraphs : undefined,
      nextLink.url
    );
  }

  // 2. Check if the latest chapter has a sourceChapterUrl and crawl it for a "Next Chapter" link
  const lastChapter = novel.chapters[novel.chapters.length - 1];
  const lastChapterUrl = lastChapter?.sourceChapterUrl;
  if (lastChapterUrl) {
    const lastChapExtracted = await fetchAndExtractUrl(lastChapterUrl, false);
    const candidateNextUrl =
      lastChapExtracted.nextChapterUrl ||
      (Array.isArray(lastChapExtracted.chapterLinks)
        ? lastChapExtracted.chapterLinks.find((l) => !existingUrls.has(l.url))?.url
        : undefined);

    if (candidateNextUrl && !existingUrls.has(candidateNextUrl)) {
      const nextChapData = await fetchAndExtractUrl(candidateNextUrl, false);
      const nextChapParagraphs = Array.isArray(nextChapData?.paragraphs)
        ? nextChapData.paragraphs
        : [];
      if (nextChapData.nextChapterUrl && !existingUrls.has(nextChapData.nextChapterUrl)) {
        novel.pendingChapterLinks = [
          {
            title:
              nextChapData.nextChapterTitle && !isNavigationOnlyLabel(nextChapData.nextChapterTitle)
                ? nextChapData.nextChapterTitle
                : `Chương ${getNextChapterNumber(novel) + 1}`,
            url: nextChapData.nextChapterUrl
          },
          ...(novel.pendingChapterLinks || [])
        ];
      }

      const nextNum = getNextChapterNumber(novel);
      const candidateTitle =
        nextChapData.chapterTitle ||
        (lastChapExtracted.nextChapterTitle &&
        !isNavigationOnlyLabel(lastChapExtracted.nextChapterTitle)
          ? lastChapExtracted.nextChapterTitle
          : '') ||
        `Chương ${nextNum}`;
      const resolvedTitle = cleanChapterTitleText(candidateTitle, nextNum);

      return generateNextChapterForNovel(
        novel,
        resolvedTitle,
        nextChapParagraphs.length >= 2 ? nextChapParagraphs : undefined,
        candidateNextUrl
      );
    }
  }

  // 3. Re-crawl novel.sourceUrl (index/TOC page or RSS feed) for newly added chapter links
  if (novel.sourceUrl) {
    const extracted = await fetchAndExtractUrl(novel.sourceUrl, false);
    if (Array.isArray(extracted.chapterLinks) && extracted.chapterLinks.length > 0) {
      const freshLinks = extracted.chapterLinks.filter((l) => !existingUrls.has(l.url));
      if (freshLinks.length > 0) {
        const firstFresh = freshLinks.shift()!;
        novel.pendingChapterLinks = freshLinks.map((l) => ({ title: l.title, url: l.url }));

        const chapData = await fetchAndExtractUrl(firstFresh.url, false);
        const chapParagraphs = Array.isArray(chapData?.paragraphs) ? chapData.paragraphs : [];
        if (
          chapData.nextChapterUrl &&
          !existingUrls.has(chapData.nextChapterUrl) &&
          !novel.pendingChapterLinks.some((l) => l.url === chapData.nextChapterUrl)
        ) {
          novel.pendingChapterLinks.unshift({
            title:
              chapData.nextChapterTitle && !isNavigationOnlyLabel(chapData.nextChapterTitle)
                ? chapData.nextChapterTitle
                : `Chương ${getNextChapterNumber(novel) + 1}`,
            url: chapData.nextChapterUrl
          });
        }

        const nextNum = getNextChapterNumber(novel);
        const candidateTitle =
          chapData.chapterTitle ||
          (!isNavigationOnlyLabel(firstFresh.title) ? firstFresh.title : '') ||
          `Chương ${nextNum}`;
        const resolvedTitle = cleanChapterTitleText(candidateTitle, nextNum);

        return generateNextChapterForNovel(
          novel,
          resolvedTitle,
          chapParagraphs.length >= 2 ? chapParagraphs : undefined,
          firstFresh.url
        );
      }
    }
  }

  return generateNextChapterForNovel(novel);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcastEvent(event: RealtimeUpdateEvent) {
    const payload = JSON.stringify(event);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  function broadcastPresence() {
    let activeCount = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) activeCount++;
    });
    broadcastEvent({
      id: `presence-${Date.now()}`,
      type: 'presence:update',
      activeReaders: Math.max(1, activeCount),
      timestamp: new Date().toISOString()
    });
  }

  wss.on('connection', (ws) => {
    let activeCount = 0;
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) activeCount++;
    });

    const initEvent: RealtimeUpdateEvent = {
      id: `init-${Date.now()}`,
      type: 'init:state',
      novels: novelsState,
      activeReaders: Math.max(1, activeCount),
      timestamp: new Date().toISOString()
    };
    ws.send(JSON.stringify(initEvent));

    broadcastPresence();

    ws.on('close', () => {
      broadcastPresence();
    });
  });

  // REST API Endpoints
  app.get('/api/novels', (_req, res) => {
    res.json({
      novels: novelsState,
      recentEvents: recentEvents.slice(0, 15)
    });
  });

  // Preview/extract metadata from a URL before importing
  app.post('/api/novels/preview-url', async (req, res) => {
    const { url } = req.body as { url?: string };
    if (!url || !url.trim()) {
      res.status(400).json({ error: 'Vui lòng nhập địa chỉ URL hợp lệ.' });
      return;
    }

    try {
      const normalizedUrl = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
      new URL(normalizedUrl);
      const extracted = await fetchAndExtractUrl(normalizedUrl, true);
      res.json({
        url: normalizedUrl,
        ...extracted
      });
    } catch {
      res.status(400).json({ error: 'Địa chỉ URL không hợp lệ. Hãy bắt đầu bằng https://...' });
    }
  });

  // Import a novel from URL and enable automatic chapter fetching
  app.post('/api/novels/import-url', async (req, res) => {
    const {
      url,
      title,
      author,
      genre,
      synopsis,
      coverStyle,
      coverImageUrl,
      autoFetchEnabled = true
    } = req.body as {
      url?: string;
      title?: string;
      author?: string;
      genre?: string;
      synopsis?: string;
      coverStyle?: Novel['coverStyle'];
      coverImageUrl?: string;
      autoFetchEnabled?: boolean;
    };

    if (!url || !url.trim()) {
      res.status(400).json({ error: 'Vui lòng nhập URL nguồn truyện.' });
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
      new URL(normalizedUrl);
    } catch {
      res.status(400).json({ error: 'Định dạng URL không hợp lệ.' });
      return;
    }

    const extracted = await fetchAndExtractUrl(normalizedUrl, true);
    const cleanedUserTitle = title?.trim() ? cleanNovelTitleText(title.trim()) : '';
    const finalTitle = cleanedUserTitle || extracted.title || 'Truyện Đồng Bộ URL';
    const finalAuthor = author?.trim() || extracted.author || 'Nguồn Web';
    const finalGenre = genre?.trim() || extracted.genre || 'Huyền Huyễn';
    const finalSynopsis = synopsis?.trim() || extracted.synopsis;
    const finalCoverImageUrl = coverImageUrl?.trim() || extracted.coverImageUrl;

    const slugId =
      finalTitle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Math.floor(100 + Math.random() * 900);

    const nowIso = new Date().toISOString();

    let initialParagraphs = Array.isArray(extracted?.paragraphs) ? extracted.paragraphs : [];
    let firstChapterTitle = cleanChapterTitleText(
      extracted.chapterTitle || 'Khởi đầu hành trình',
      1
    );
    let firstChapterSourceUrl = normalizedUrl;
    const pendingLinks = (Array.isArray(extracted?.chapterLinks) ? extracted.chapterLinks : []).map(
      (l) => ({
        title: l.title,
        url: l.url
      })
    );

    // If the URL was a table-of-contents page with few story paragraphs, automatically pull Chapter 1 from firstChapterUrl or the first chapter link
    if (initialParagraphs.length < 3 && (extracted.firstChapterUrl || pendingLinks.length > 0)) {
      const targetFirstUrl = extracted.firstChapterUrl || pendingLinks[0]?.url;
      if (targetFirstUrl) {
        const idxInPending = pendingLinks.findIndex((l) => l.url === targetFirstUrl);
        const firstLinkMeta = idxInPending !== -1 ? pendingLinks.splice(idxInPending, 1)[0] : undefined;

        firstChapterSourceUrl = targetFirstUrl;
        const chapExtracted = await fetchAndExtractUrl(targetFirstUrl, false);
        const chapParagraphs = Array.isArray(chapExtracted?.paragraphs)
          ? chapExtracted.paragraphs
          : [];
        firstChapterTitle = cleanChapterTitleText(
          chapExtracted.chapterTitle ||
            (firstLinkMeta && !isNavigationOnlyLabel(firstLinkMeta.title)
              ? firstLinkMeta.title
              : '') ||
            'Chương 1',
          1
        );
        if (chapParagraphs.length >= 2) {
          initialParagraphs = chapParagraphs;
        }
        if (
          chapExtracted.nextChapterUrl &&
          chapExtracted.nextChapterUrl !== targetFirstUrl
        ) {
          // Ensure nextChapterUrl is at the front of pendingLinks so Chapter 2 is fetched next
          const existingNextIdx = pendingLinks.findIndex(
            (l) => l.url === chapExtracted.nextChapterUrl
          );
          if (existingNextIdx > 0) {
            const [nextItem] = pendingLinks.splice(existingNextIdx, 1);
            pendingLinks.unshift(nextItem);
          } else if (existingNextIdx === -1) {
            pendingLinks.unshift({
              title:
                chapExtracted.nextChapterTitle &&
                !isNavigationOnlyLabel(chapExtracted.nextChapterTitle)
                  ? chapExtracted.nextChapterTitle
                  : 'Chương 2',
              url: chapExtracted.nextChapterUrl
            });
          }
        }
      }
    } else if (
      extracted.nextChapterUrl &&
      !pendingLinks.some((l) => l.url === extracted.nextChapterUrl)
    ) {
      pendingLinks.unshift({
        title:
          extracted.nextChapterTitle && !isNavigationOnlyLabel(extracted.nextChapterTitle)
            ? extracted.nextChapterTitle
            : 'Chương 2',
        url: extracted.nextChapterUrl
      });
    }

    if (initialParagraphs.length === 0) {
      initialParagraphs = [
        `Giữa thế giới "${finalTitle}", hành trình của tác giả ${finalAuthor} thuộc thể loại ${finalGenre} vừa chính thức khai mở từ nguồn ${new URL(normalizedUrl).hostname}.`,
        finalSynopsis,
        'Từng trang cổ thư đang dần hé lộ những bí ẩn đầu tiên trên con đường tu đạo mênh mông.'
      ];
    }

    const chapter1: Chapter = {
      id: `${slugId}-c1`,
      novelId: slugId,
      number: 1,
      title: firstChapterTitle,
      content: initialParagraphs,
      wordCount: countWords(initialParagraphs),
      publishedAt: nowIso,
      sourceChapterUrl: firstChapterSourceUrl
    };

    const newNovel: Novel = {
      id: slugId,
      title: finalTitle,
      author: finalAuthor,
      genre: finalGenre,
      status: 'Đang ra',
      synopsis: finalSynopsis,
      coverStyle: coverStyle || 'star-nebula',
      ...(finalCoverImageUrl ? { coverImageUrl: finalCoverImageUrl } : {}),
      views: 1,
      rating: 5.0,
      updatedAt: nowIso,
      chapters: [chapter1],
      sourceUrl: extracted.parentBookUrl || normalizedUrl,
      autoFetchEnabled: Boolean(autoFetchEnabled),
      lastSyncedAt: nowIso,
      pendingChapterLinks: pendingLinks
    };

    novelsState.unshift(newNovel);

    const event: RealtimeUpdateEvent = {
      id: `evt-novel-${newNovel.id}`,
      type: 'novel:created',
      novelId: newNovel.id,
      novelTitle: newNovel.title,
      novel: newNovel,
      chapter: chapter1,
      timestamp: nowIso
    };

    recentEvents.unshift(event);
    if (recentEvents.length > 30) recentEvents.pop();

    broadcastEvent(event);

    res.status(201).json({
      novel: newNovel,
      event
    });
  });

  // Trigger an immediate URL sync for a specific novel
  app.post('/api/novels/:novelId/sync-url', async (req, res) => {
    const { novelId } = req.params;
    const novel = novelsState.find((n) => n.id === novelId);
    if (!novel) {
      res.status(404).json({ error: 'Không tìm thấy truyện này.' });
      return;
    }

    const newChapter = await syncNovelFromSourceUrl(novel);

    const event: RealtimeUpdateEvent = {
      id: `evt-${newChapter.id}`,
      type: 'chapter:published',
      novelId: novel.id,
      novelTitle: novel.title,
      chapter: newChapter,
      timestamp: newChapter.publishedAt
    };

    recentEvents.unshift(event);
    if (recentEvents.length > 30) recentEvents.pop();

    broadcastEvent(event);

    res.status(201).json({
      novel,
      chapter: newChapter,
      event
    });
  });

  // Toggle autoFetchEnabled for a URL-linked novel
  app.patch('/api/novels/:novelId/auto-fetch', (req, res) => {
    const { novelId } = req.params;
    const { autoFetchEnabled } = req.body as { autoFetchEnabled?: boolean };
    const novel = novelsState.find((n) => n.id === novelId);
    if (!novel) {
      res.status(404).json({ error: 'Không tìm thấy truyện.' });
      return;
    }
    novel.autoFetchEnabled = Boolean(autoFetchEnabled);
    res.json({ novel });
  });

  // Update book cover style or custom uploaded cover image for a novel
  app.patch('/api/novels/:novelId/cover', (req, res) => {
    const { novelId } = req.params;
    const { coverStyle, coverImageUrl } = req.body as {
      coverStyle?: Novel['coverStyle'];
      coverImageUrl?: string;
    };
    const novel = novelsState.find((n) => n.id === novelId);
    if (!novel) {
      res.status(404).json({ error: 'Không tìm thấy truyện.' });
      return;
    }
    if (coverStyle) {
      novel.coverStyle = coverStyle;
    }
    if (typeof coverImageUrl === 'string') {
      if (coverImageUrl.trim()) {
        novel.coverImageUrl = coverImageUrl.trim();
      } else {
        delete novel.coverImageUrl;
      }
    }
    novel.updatedAt = new Date().toISOString();

    const event: RealtimeUpdateEvent = {
      id: `evt-cover-${novel.id}-${Date.now()}`,
      type: 'novel:updated',
      novelId: novel.id,
      novelTitle: novel.title,
      novel,
      timestamp: novel.updatedAt
    };
    broadcastEvent(event);

    res.json({ novel, event });
  });

  // Delete a novel from server state
  app.delete('/api/novels/:novelId', (req, res) => {
    const { novelId } = req.params;
    const idx = novelsState.findIndex((n) => n.id === novelId);
    if (idx !== -1) {
      novelsState.splice(idx, 1);
    }

    broadcastEvent({
      id: `evt-del-${novelId}-${Date.now()}`,
      type: 'init:state',
      novels: novelsState,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, novels: novelsState });
  });

  // In-memory cache for synthesized TTS audio to eliminate network delay & stutter
  const ttsAudioCache = new Map<string, { buffer: Buffer; mimeType: string }>();
  const ttsChunkCache = new Map<string, Buffer>();

  const geminiClient = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      })
    : null;

  function normalizeVietnameseTtsText(raw: string): string {
    return raw
      .replace(/\[([^\]]+)\]/g, '$1.')
      .replace(/\bC\.(\d+)\b/gi, 'Chương $1')
      .replace(/[“”"«»„‟‹›']/g, ' ')
      .replace(/[—–―-]+/g, ', ')
      .replace(/\.{2,}|…+/g, '. ')
      .replace(/([,;:?!.])(?=[^\s])/g, '$1 ')
      .replace(/[&<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getQuynhAnhProsodyForVoice(voiceId?: string): { pitch: string; rate: string } {
    switch (voiceId) {
      case 'quynh-anh-4-0':
        return { pitch: '+2Hz', rate: '+4%' };
      case 'nu-review-phim':
        return { pitch: '+2Hz', rate: '+6%' };
      case 'nu-kich-tinh':
        return { pitch: '+1Hz', rate: '+7%' };
      case 'nu-tien-hiep':
        return { pitch: '+0Hz', rate: '+2%' };
      case 'nu-ha-noi':
        return { pitch: '-1Hz', rate: '+0%' };
      case 'nu-ngot-ngao':
        return { pitch: '+3Hz', rate: '-3%' };
      default:
        return { pitch: '+2Hz', rate: '+4%' };
    }
  }

  // Primary Engine: Quỳnh Anh 4.0 Neural Vietnamese Female Voice (full-paragraph continuous MP3 stream, zero mid-sentence cuts)
  async function synthesizeQuynhAnhNeuralMp3(cleanText: string, voiceId?: string): Promise<Buffer> {
    const tts = new MsEdgeTTS();
    let timeoutHandle: NodeJS.Timeout | null = null;

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
        timeoutHandle = setTimeout(() => reject(new Error('Neural TTS timeout')), 7500);
      });

      return await Promise.race([synthesisPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        tts.close();
      } catch {
        // ignore close errors
      }
    }
  }

  // Secondary Engine: Gemini 3.8 Flash Lite TTS (Kore/Zephyr female voice)
  async function synthesizeGeminiFemaleWav(cleanText: string, voiceId?: string): Promise<Buffer> {
    if (!geminiClient) throw new Error('Gemini client unavailable');
    const voiceName =
      voiceId === 'nu-tien-hiep' || voiceId === 'nu-ngot-ngao' ? 'Zephyr' : 'Kore';

    const response = await geminiClient.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanText
            }
          ]
        }
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    });

    const b64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error('Empty Gemini TTS audio');
    return Buffer.from(b64, 'base64');
  }

  function splitIntoNaturalVietnameseClauses(cleanText: string, maxLen = 190): string[] {
    const sentences = cleanText
      .split(/(?<=[.?!;])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const clauses: string[] = [];

    for (const sentence of sentences) {
      if (sentence.length <= maxLen) {
        clauses.push(sentence);
        continue;
      }

      const subParts = sentence
        .split(/(?<=[,:])\s+/)
        .map((p) => p.trim())
        .filter(Boolean);

      let currentClause = '';
      for (const part of subParts) {
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
                if (wordChunk) clauses.push(wordChunk);
                wordChunk = w.slice(0, maxLen);
              }
            }
            currentClause = wordChunk;
          }
        } else if ((currentClause + ' ' + part).length <= maxLen) {
          currentClause = `${currentClause} ${part}`;
        } else {
          clauses.push(currentClause);
          currentClause = part;
        }
      }
      if (currentClause) {
        clauses.push(currentClause);
      }
    }

    const merged: string[] = [];
    for (const c of clauses) {
      if (
        merged.length > 0 &&
        merged[merged.length - 1].length < 45 &&
        merged[merged.length - 1].length + 1 + c.length <= maxLen
      ) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${c}`;
      } else {
        merged.push(c);
      }
    }

    return merged;
  }

  async function fetchSingleTtsChunk(chunk: string): Promise<Buffer> {
    const cached = ttsChunkCache.get(chunk);
    if (cached) return cached;

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(
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

    if (ttsChunkCache.size > 400) {
      const firstKey = ttsChunkCache.keys().next().value;
      if (firstKey) ttsChunkCache.delete(firstKey);
    }
    ttsChunkCache.set(chunk, buf);
    return buf;
  }

  // Synthesize Vietnamese Female TTS audio (Quỳnh Anh 4.0 Neural Voice + 6 female personas)
  app.post('/api/tts', async (req, res) => {
    const { text, voiceId } = req.body as { text?: string; voiceId?: string };
    const cleanText = normalizeVietnameseTtsText(text || '');
    if (!cleanText) {
      res.status(400).json({ error: 'Empty text' });
      return;
    }

    const activeVoiceId = voiceId || 'quynh-anh-4-0';
    const cacheKey = `${activeVoiceId}::${cleanText}`;
    const cachedAudio = ttsAudioCache.get(cacheKey);
    if (cachedAudio) {
      res.json({
        audioBase64: cachedAudio.buffer.toString('base64'),
        mimeType: cachedAudio.mimeType
      });
      return;
    }

    // 1. Try Quỳnh Anh 4.0 Neural Vietnamese Female TTS (single continuous stream, ultra-natural & gapless)
    try {
      const neuralMp3Buffer = await synthesizeQuynhAnhNeuralMp3(cleanText, activeVoiceId);
      if (ttsAudioCache.size > 250) {
        const oldestKey = ttsAudioCache.keys().next().value;
        if (oldestKey) ttsAudioCache.delete(oldestKey);
      }
      ttsAudioCache.set(cacheKey, { buffer: neuralMp3Buffer, mimeType: 'audio/mpeg' });
      res.json({
        audioBase64: neuralMp3Buffer.toString('base64'),
        mimeType: 'audio/mpeg'
      });
      return;
    } catch {
      // Fall through to secondary engine if neural stream fails
    }

    // 2. Fallback to Gemini 3.8 Flash Lite TTS
    try {
      const geminiWavBuffer = await synthesizeGeminiFemaleWav(cleanText, activeVoiceId);
      ttsAudioCache.set(cacheKey, { buffer: geminiWavBuffer, mimeType: 'audio/wav' });
      res.json({
        audioBase64: geminiWavBuffer.toString('base64'),
        mimeType: 'audio/wav'
      });
      return;
    } catch {
      // Fall through to clause-based TTS
    }

    // 3. Final fallback: natural clause-split TTS
    const chunks = splitIntoNaturalVietnameseClauses(cleanText, 190).slice(0, 14);
    try {
      const buffers = await Promise.all(chunks.map((chunk) => fetchSingleTtsChunk(chunk)));
      const combined = Buffer.concat(buffers);
      ttsAudioCache.set(cacheKey, { buffer: combined, mimeType: 'audio/mpeg' });
      res.json({
        audioBase64: combined.toString('base64'),
        mimeType: 'audio/mpeg'
      });
    } catch {
      res.status(502).json({ error: 'TTS stream unavailable' });
    }
  });

  // Create a new novel manually with initial chapter 1 and broadcast via WebSocket
  app.post('/api/novels', (req, res) => {
    const {
      title,
      author,
      genre,
      synopsis,
      coverStyle,
      coverImageUrl,
      firstChapterTitle,
      firstChapterContent
    } = req.body as {
      title?: string;
      author?: string;
      genre?: string;
      synopsis?: string;
      coverStyle?: Novel['coverStyle'];
      coverImageUrl?: string;
      firstChapterTitle?: string;
      firstChapterContent?: string | string[];
    };

    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Vui lòng nhập tên truyện.' });
      return;
    }

    const cleanTitle = title.trim();
    const cleanAuthor = author?.trim() || 'Ẩn Danh';
    const cleanGenre = genre?.trim() || 'Tiên Hiệp';
    const slugId =
      cleanTitle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') +
      '-' +
      Math.floor(100 + Math.random() * 900);

    const nowIso = new Date().toISOString();

    let chapterParagraphs: string[] = [];
    if (Array.isArray(firstChapterContent)) {
      chapterParagraphs = firstChapterContent.filter((p) => p.trim().length > 0);
    } else if (typeof firstChapterContent === 'string' && firstChapterContent.trim().length > 0) {
      chapterParagraphs = firstChapterContent
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (chapterParagraphs.length === 0) {
      chapterParagraphs = [
        `Giữa trời đất mênh mông của thế giới "${cleanTitle}", những biến chuyển đầu tiên đã âm thầm khởi phát. Tác giả ${cleanAuthor} mở ra một hành trình mới thuộc thể loại ${cleanGenre}, nơi vận mệnh và nhân quả đan xen qua từng trang sách.`,
        synopsis?.trim() ||
          'Không một ai biết trước điểm cuối của con đường phía trước, chỉ có bước chân kiên định vượt qua muôn trùng thử thách mới có thể chạm tới chân lý cuối cùng.',
        'Khí cơ thiên địa vừa động, chương mở đầu khép lại cũng là lúc bức màn bí ẩn chính thức được vén lên.'
      ];
    }

    const chapter1: Chapter = {
      id: `${slugId}-c1`,
      novelId: slugId,
      number: 1,
      title: firstChapterTitle?.trim() || 'Khởi đầu hành trình',
      content: chapterParagraphs,
      wordCount: countWords(chapterParagraphs),
      publishedAt: nowIso
    };

    const newNovel: Novel = {
      id: slugId,
      title: cleanTitle,
      author: cleanAuthor,
      genre: cleanGenre,
      status: 'Đang ra',
      synopsis:
        synopsis?.trim() ||
        `Tác phẩm ${cleanGenre} đặc sắc của tác giả ${cleanAuthor}, được cập nhật chương mới tự động theo thời gian thực trên Mạc Thư Các.`,
      coverStyle: coverStyle || 'ink-mountain',
      ...(coverImageUrl ? { coverImageUrl } : {}),
      views: 1,
      rating: 5.0,
      updatedAt: nowIso,
      chapters: [chapter1]
    };

    novelsState.unshift(newNovel);

    const event: RealtimeUpdateEvent = {
      id: `evt-novel-${newNovel.id}`,
      type: 'novel:created',
      novelId: newNovel.id,
      novelTitle: newNovel.title,
      novel: newNovel,
      chapter: chapter1,
      timestamp: nowIso
    };

    recentEvents.unshift(event);
    if (recentEvents.length > 30) recentEvents.pop();

    broadcastEvent(event);

    res.status(201).json({
      novel: newNovel,
      event
    });
  });

  // Publish a new chapter to a specific novel (supports manual text, direct chapterUrl, or smart auto-fetch)
  app.post('/api/novels/:novelId/chapters', async (req, res) => {
    const { novelId } = req.params;
    const { title, content, chapterUrl } = req.body as {
      title?: string;
      content?: string[] | string;
      chapterUrl?: string;
    };

    const novel = novelsState.find((n) => n.id === novelId);
    if (!novel) {
      res.status(404).json({ error: 'Không tìm thấy truyện này.' });
      return;
    }

    let parsedParagraphs: string[] | undefined;
    let resolvedTitle = title?.trim();
    let resolvedSourceUrl: string | undefined;

    if (chapterUrl && chapterUrl.trim()) {
      try {
        const normalizedChapUrl = chapterUrl.trim().startsWith('http')
          ? chapterUrl.trim()
          : `https://${chapterUrl.trim()}`;
        new URL(normalizedChapUrl);
        const extracted = await fetchAndExtractUrl(normalizedChapUrl);
        const extractedParagraphs = Array.isArray(extracted?.paragraphs) ? extracted.paragraphs : [];
        if (extractedParagraphs.length >= 1) {
          parsedParagraphs = extractedParagraphs;
        }
        if (!resolvedTitle) {
          resolvedTitle = extracted.chapterTitle || extracted.title;
        }
        resolvedSourceUrl = normalizedChapUrl;
        if (extracted.nextChapterUrl) {
          const existingPending = novel.pendingChapterLinks || [];
          if (!existingPending.some((l) => l.url === extracted.nextChapterUrl)) {
            novel.pendingChapterLinks = [
              ...existingPending,
              {
                title: extracted.nextChapterTitle || `Chương ${getNextChapterNumber(novel) + 1}`,
                url: extracted.nextChapterUrl
              }
            ];
          }
        }
      } catch {
        res.status(400).json({ error: 'Đường dẫn URL chương không hợp lệ.' });
        return;
      }
    } else if (Array.isArray(content)) {
      parsedParagraphs = content.filter((line) => line.trim().length > 0);
    } else if (typeof content === 'string' && content.trim().length > 0) {
      parsedParagraphs = content
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const newChapter =
      !parsedParagraphs && !resolvedTitle && novel.sourceUrl
        ? await syncNovelFromSourceUrl(novel)
        : generateNextChapterForNovel(novel, resolvedTitle, parsedParagraphs, resolvedSourceUrl);

    const event: RealtimeUpdateEvent = {
      id: `evt-${newChapter.id}`,
      type: 'chapter:published',
      novelId: novel.id,
      novelTitle: novel.title,
      chapter: newChapter,
      timestamp: newChapter.publishedAt
    };

    recentEvents.unshift(event);
    if (recentEvents.length > 30) recentEvents.pop();

    broadcastEvent(event);

    res.status(201).json({
      novel,
      chapter: newChapter,
      event
    });
  });

  // Trigger an instant chapter release for a specified or prioritized novel
  app.post('/api/realtime/release-next', async (req, res) => {
    const { novelId } = req.body as { novelId?: string };
    if (novelsState.length === 0) {
      res.status(400).json({ error: 'Kho truyện hiện đang trống. Vui lòng thêm truyện mới trước.' });
      return;
    }
    const urlLinkedNovels = novelsState.filter((n) => n.sourceUrl && n.autoFetchEnabled);
    const targetNovel =
      (novelId && novelsState.find((n) => n.id === novelId)) ||
      (urlLinkedNovels.length > 0 ? urlLinkedNovels[0] : novelsState[0]);

    if (!targetNovel) {
      res.status(404).json({ error: 'Không tìm thấy truyện để cập nhật chương.' });
      return;
    }

    const newChapter = targetNovel.sourceUrl
      ? await syncNovelFromSourceUrl(targetNovel)
      : generateNextChapterForNovel(targetNovel);

    const event: RealtimeUpdateEvent = {
      id: `evt-${newChapter.id}`,
      type: 'chapter:published',
      novelId: targetNovel.id,
      novelTitle: targetNovel.title,
      chapter: newChapter,
      timestamp: newChapter.publishedAt
    };

    recentEvents.unshift(event);
    if (recentEvents.length > 30) recentEvents.pop();

    broadcastEvent(event);

    res.status(201).json({
      novel: targetNovel,
      chapter: newChapter,
      event
    });
  });

  // Server-side scheduled chapter crawler & auto-release every 35 seconds when readers are connected
  let roundRobinIndex = 0;
  setInterval(async () => {
    let connectedClients = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) connectedClients++;
    });

    if (connectedClients === 0) return;

    const pool = novelsState.filter((n) => n.sourceUrl && n.autoFetchEnabled);
    if (pool.length === 0) return;

    const targetNovel = pool[roundRobinIndex % pool.length];
    roundRobinIndex++;

    const newChapter = await syncNovelFromSourceUrl(targetNovel);

    const event: RealtimeUpdateEvent = {
      id: `evt-${newChapter.id}`,
      type: 'chapter:published',
      novelId: targetNovel.id,
      novelTitle: targetNovel.title,
      chapter: newChapter,
      timestamp: newChapter.publishedAt
    };

    recentEvents.unshift(event);
    if (recentEvents.length > 30) recentEvents.pop();

    broadcastEvent(event);
  }, 35000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
