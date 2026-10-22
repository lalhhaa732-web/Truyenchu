import { Novel } from '../types';

export const SAMPLE_NOVEL_IDS: string[] = [
  'nguoi-tren-van-nguoi',
  'kiem-lai-thien-ha',
  'thanh-van-kiem-tich',
  'van-co-kiem-ton',
  'co-anh-thanh-tich-luoc',
  'da-anh-truong-an',
  'phong-nguyet-kinh-hua',
  'tram-nam-tinh-ha',
  'bien-nien-su-sao-bang',
  'hai-dang-luong-tu',
  'van-co-thu-vien',
  'son-hai-di-van-luc',
  'cuu-chau-muc-linh-do'
];

export const INITIAL_NOVELS: Novel[] = [];

export const AUTO_CHAPTER_POOL: Record<string, { titles: string[]; paragraphs: string[][] }> = {};
