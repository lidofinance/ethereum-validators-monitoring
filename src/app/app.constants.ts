import * as buildInfo from 'build-info';

export const APP_NAME = process.env.npm_package_name;
export const APP_DESCRIPTION = process.env.npm_package_description;

/**
 * What outgoing requests identify themselves as, so an endpoint operator can tell whose traffic
 * this is. APP_NAME is only set when a package manager script started the process, and an
 * unidentified agent is worse than a literal.
 */
export const USER_AGENT = `${APP_NAME ?? 'ethereum-validators-monitoring'}/${buildInfo.version}`;
