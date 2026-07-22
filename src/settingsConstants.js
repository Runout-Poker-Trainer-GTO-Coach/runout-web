/**
 * Field names on the app settings Firestore document (`config/app` by default).
 */
export const APP_SETTINGS_FIELDS = {
  showDiscountScreenIos: 'showDiscountScreenIos',
  showDiscountScreenAndroid: 'showDiscountScreenAndroid',
  /** Global: when true, clients may treat everyone as in an “all unlimited” experiment (see user `autoUnlimitedSession`). */
  unlimitedSessions: 'unlimitedSessions',
  /** Percentage (0–100) of users who should see the App2Web (web checkout) option. 0 hides it for everyone, 100 shows it to all. */
  app2WebPercentage: 'app2WebPercentage',
}

/** @type {Record<keyof typeof APP_SETTINGS_FIELDS, boolean | number>} */
export const APP_SETTINGS_DEFAULTS = {
  showDiscountScreenIos: false,
  showDiscountScreenAndroid: false,
  unlimitedSessions: false,
  app2WebPercentage: 0,
}
