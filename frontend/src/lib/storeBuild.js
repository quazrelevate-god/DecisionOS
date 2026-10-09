/* THE APP-STORE BUILD (2026-10-09).
 *
 * True only in the build that goes to Google Play and the App Store —
 * REACT_APP_NATIVE=1, which the cap:sync scripts set — and false on the
 * website. A build-time constant, so the branch the store build does not take
 * is not in its bundle at all (the same mechanism that leaves the admin
 * portal out of the APK, App.js).
 *
 * What it is for: Play's Payments policy. A workspace's plan is a digital
 * subscription, and inside an app distributed on Play it may only be sold
 * through Play's own billing — and the app may not point people to another
 * way of paying for it either ("messaging… or other calls to action"). The
 * website keeps its Razorpay checkout and its upgrade copy unchanged; the
 * store build shows where the plan stands and stops there.
 */
export const STORE_BUILD = process.env.REACT_APP_NATIVE === "1";
