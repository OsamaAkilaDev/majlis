/**
 * The header the lifecycle sweep secret travels in.
 *
 * It lives here, not on the controller, because the logging config has to
 * redact it and importing the controller into the logger would run the events
 * module at bootstrap. One constant, two consumers, no cycle.
 */
export const SWEEP_SECRET_HEADER = 'x-lifecycle-sweep-secret';

/**
 * The header the notification delivery sweep's secret travels in. A separate
 * secret from the lifecycle sweep's, and a separate header, so one leaked
 * scheduler credential does not authorise the other endpoint.
 */
export const NOTIFICATION_SWEEP_SECRET_HEADER = 'x-notification-sweep-secret';
