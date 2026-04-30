/**
 * Field names on the app settings Firestore document (`config/app` by default).
 */
export const APP_SETTINGS_FIELDS = {
  showDiscountScreenIos: 'showDiscountScreenIos',
  showDiscountScreenAndroid: 'showDiscountScreenAndroid',
  /** Global: when true, clients may treat everyone as in an “all unlimited” experiment (see user `autoUnlimitedSession`). */
  unlimitedSessions: 'unlimitedSessions',
}

/** @type {Record<keyof typeof APP_SETTINGS_FIELDS, boolean>} */
export const APP_SETTINGS_DEFAULTS = {
  showDiscountScreenIos: false,
  showDiscountScreenAndroid: false,
  unlimitedSessions: false,
}
