import pkg from '../../package.json';

/**
 * Single source of truth for the version string the landing renders
 * (Footer, download links, etc.). Resolved at build time from the
 * landing package.json so the release pipeline only has to bump one
 * file per package, and the value in the deployed site always matches
 * `latest.json`'s `version` field.
 */
export const APP_VERSION: string = pkg.version;
