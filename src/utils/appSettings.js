import { readLatestMeta, writeMeta } from './metaStore.js';

export const DEFAULT_APP_SETTINGS = {
  allowPublicSignup: true,
  allowWaitlist: true,
  allowContact: true,
  maintenanceMode: false,
};

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'da', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nu', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

export function sanitizeAppSettings(payload = {}) {
  return {
    allowPublicSignup: normalizeBoolean(payload.allowPublicSignup, DEFAULT_APP_SETTINGS.allowPublicSignup),
    allowWaitlist: normalizeBoolean(payload.allowWaitlist, DEFAULT_APP_SETTINGS.allowWaitlist),
    allowContact: normalizeBoolean(payload.allowContact, DEFAULT_APP_SETTINGS.allowContact),
    maintenanceMode: normalizeBoolean(payload.maintenanceMode, DEFAULT_APP_SETTINGS.maintenanceMode),
  };
}

export async function getAppSettings(prisma) {
  const payload = await readLatestMeta(prisma, { action: 'APP_SETTINGS' });
  return {
    ...DEFAULT_APP_SETTINGS,
    ...sanitizeAppSettings(payload || {}),
  };
}

export async function saveAppSettings(prisma, payload, userId = null) {
  const settings = sanitizeAppSettings(payload || {});
  await writeMeta(prisma, {
    userId,
    action: 'APP_SETTINGS',
    type: 'settings',
    detail: settings,
    status: 'SUCCESS',
  });
  return settings;
}
