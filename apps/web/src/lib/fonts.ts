import { Fraunces, IBM_Plex_Sans } from 'next/font/google';

export const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
});

export const fraunces = Fraunces({
  subsets: ['latin'],
  // next/font/google only allows axes when weight is 'variable', not a discrete list.
  weight: 'variable',
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
});
