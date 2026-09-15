import * as buildInfo from 'build-info';

export const APP_NAME = process.env.npm_package_name;
export const APP_DESCRIPTION = process.env.npm_package_description;

/** APP_NAME is empty unless a package manager script started the process, hence the literal. */
export const USER_AGENT = `${APP_NAME ?? 'ethereum-validators-monitoring'}/${buildInfo.version}`;
