import { loadFont as geist } from '@remotion/google-fonts/Geist';
import { loadFont as geistMono } from '@remotion/google-fonts/GeistMono';
import { loadFont as pixel } from '@remotion/google-fonts/Silkscreen';

// Same palette as the studio app (src/components/studio/studio.css).
export const C = {
  bg: '#000000',
  panel: '#0b0b0b',
  raised: '#121212',
  text: '#f2f0e9',
  text2: '#aaaeb7',
  text3: '#858b96',
  accent: '#e8c45a',
  bad: '#e5484d',
  badText: '#f2777b',
  good: '#4cc38a',
  entire: '#a78bfa',
  neatlogs: '#4fb8d0',
};

export const F = {
  sans: geist('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] }).fontFamily,
  mono: geistMono('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily,
  pixel: pixel('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily,
};

export const FPS = 30;
