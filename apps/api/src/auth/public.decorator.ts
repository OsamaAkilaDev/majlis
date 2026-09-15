import { SetMetadata } from '@nestjs/common';

/**
 * The only opt-out from the global session guard. Everything else is
 * protected by default: an endpoint added later that forgets to think
 * about auth stays protected because nobody decorated it.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
