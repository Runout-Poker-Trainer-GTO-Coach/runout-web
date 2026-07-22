/**
 * A/B(/C) experiment allocations, stored on the app settings document
 * (`config/app`) under the `experiments` field:
 *
 *   experiments: {
 *     senior_paywall: { control: 34, shorter: 33, trial_shorter: 33 },
 *     beginner_trial: { control: 50, trial: 50 },
 *   }
 *
 * Each experiment's door percentages are a split that must total 100 — the
 * app buckets every matching user into exactly one door by these weights.
 * Audience detection (who is "55+" / "beginner") and the random bucketing
 * live in the mobile app; this portal only stores the weights.
 */
export const EXPERIMENTS_FIELD = 'experiments'

/**
 * @typedef {{ key: string, label: string, description: string }} ExperimentDoor
 * @typedef {{
 *   key: string,
 *   title: string,
 *   audience: string,
 *   description: string,
 *   doors: ExperimentDoor[],
 *   defaults: Record<string, number>,
 * }} Experiment
 */

/** @type {Experiment[]} */
export const EXPERIMENTS = [
  {
    key: 'senior_paywall',
    title: 'Senior paywall flow',
    audience: '55+ users',
    description:
      'Each 55+ user who shows up is randomly sorted into one of three doors.',
    doors: [
      {
        key: 'control',
        label: 'Door 1 — Current flow',
        description: 'No trial. Unchanged baseline (control group).',
      },
      {
        key: 'shorter',
        label: 'Door 2 — Shorter flow',
        description: 'Normal paywall, shorter flow.',
      },
      {
        key: 'trial_shorter',
        label: 'Door 3 — Free trial + shorter flow',
        description: 'Free trial plus the shorter flow.',
      },
    ],
    defaults: { control: 34, shorter: 33, trial_shorter: 33 },
  },
  {
    key: 'beginner_trial',
    title: 'Beginner trial',
    audience: 'Beginners',
    description: 'Each beginner is randomly sorted into one of two doors.',
    doors: [
      {
        key: 'control',
        label: 'Door 1 — Current flow',
        description: 'Unchanged baseline (control group).',
      },
      {
        key: 'trial',
        label: 'Door 2 — Free trial',
        description: 'Free trial. The only change.',
      },
    ],
    defaults: { control: 50, trial: 50 },
  },
  {
    key: 'intermediate_trial',
    title: 'Intermediate trial',
    audience: 'Intermediate players',
    description:
      'Each intermediate player is randomly sorted into one of two doors.',
    doors: [
      {
        key: 'control',
        label: 'Door 1 — Current flow',
        description: 'Unchanged baseline (control group).',
      },
      {
        key: 'trial',
        label: 'Door 2 — Free trial',
        description: 'Free trial. The only change.',
      },
    ],
    defaults: { control: 50, trial: 50 },
  },
]
