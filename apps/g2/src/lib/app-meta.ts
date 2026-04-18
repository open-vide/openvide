import pkg from '../../package.json';

export const APP_VERSION = pkg.version;

export const OPENVIDE_LINKS = {
  github: 'https://github.com/open-vide/even-open-vide',
  website: 'https://openvide.com',
  docs: 'https://github.com/open-vide/even-open-vide#readme',
} as const;

export const GUIDE_STORAGE_KEY = 'openvide_guide_dismissed';
