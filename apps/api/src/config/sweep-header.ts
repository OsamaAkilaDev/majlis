/**
 * The header the lifecycle sweep secret travels in.
 *
 * It lives here, not on the controller, because the logging config has to
 * redact it and importing the controller into the logger would run the events
 * module at bootstrap. One constant, two consumers, no cycle.
 */
export const SWEEP_SECRET_HEADER = 'x-lifecycle-sweep-secret';
