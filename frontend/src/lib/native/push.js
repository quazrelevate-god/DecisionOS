/* Device push — the client half of FCM delivery (Android/iOS).
 *
 * INERT IN A BROWSER. isNativeApp() guards every path, and @capacitor/push-
 * notifications is imported lazily, so the web bundle never pulls it in and a
 * browser that somehow ran this code would not fail on a missing native module.
 * Same shape as the other native leaves (back.js, links.js): one `start…`
 * function, mounted once from hooks/useNativeBack.js.
 *
 * WHAT IT DOES on a device:
 *   1. Asks for notification permission (once; declined = silently no push).
 *   2. Registers with FCM and hands the token to the backend (POST /api/devices).
 *   3. On a tapped notification, routes to the screen it is about — reusing
 *      notifLink(), the exact map the in-app bell already uses, off the `data`
 *      the backend attached (entity_type / entity_id / type).
 *
 * A token is per-INSTALL. It is registered when a user signs in and deleted on
 * sign-out (unregisterPush, called from AuthContext.logout) — NOT on app close,
 * because the whole point is that push keeps arriving while the app is shut.
 */
import { isNativeApp } from "./back";
import api from "../api";
import { notifLink } from "../notif";

/* Remembered so sign-out can tell the backend to stop sending to THIS device. */
let currentToken = null;

const platform = () =>
  (typeof window !== "undefined" && window.Capacitor?.getPlatform?.()) || "android";

/**
 * Register for push and wire the tap handler.
 * @param {Function} go  (path) => void — navigate, through the router
 * @returns {Promise<Function>} cleanup that removes the listeners
 */
export async function startPush(go) {
  if (!isNativeApp()) return () => {};
  /* IOS WAITS FOR AN APNs KEY. (2026-10-06, on the merge, before flashing.)
     This leaf runs on both platforms, and on iOS it reaches requestPermissions()
     — which spends the ONE notification prompt iOS ever shows — and then fails:
     the app is signed with a FREE provisioning profile, which cannot carry the
     Push Notifications capability, so register() has no `aps-environment`
     entitlement, and FCM has no APNs key uploaded for it either. The founder
     would be asked to allow notifications that can never arrive, and a "no" is
     then only reversible in iOS Settings. Android is end to end and unaffected.
     DELETE THESE TWO LINES the day the Apple developer account, the APNs key and
     the FCM upload exist — nothing else in this file is iOS-specific. */
  if (platform() === "ios") return () => {};
  const { PushNotifications } = await import("@capacitor/push-notifications");

  /* Permission first. On Android 13+ and iOS this shows the OS prompt the first
     time; after that it returns the saved answer without prompting again. */
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") return () => {};

  const handles = [];

  /* The token arrives asynchronously after register(); listen BEFORE calling
     it so the event is never missed. A token can also change later (app data
     cleared, restore) — this fires again and re-registers it. */
  handles.push(
    await PushNotifications.addListener("registration", async (token) => {
      currentToken = token?.value || null;
      if (!currentToken) return;
      try {
        await api.post("/devices", { token: currentToken, platform: platform() });
      } catch {
        /* a failed register just means no push until the next launch — the
           in-app bell still works */
      }
    })
  );

  handles.push(
    await PushNotifications.addListener("registrationError", () => {
      /* no FCM token (no Play Services, no network at launch); nothing to do */
    })
  );

  /* The founder tapped a notification (app foreground, background, or cold) —
     land on the screen it is about. */
  handles.push(
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const data = action?.notification?.data || {};
      const path = notifLink({
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        type: data.type,
      });
      if (path) go?.(path);
    })
  );

  await PushNotifications.register(); // → fires `registration` with the token
  return () => handles.forEach((h) => h.remove());
}

/**
 * Stop pushes reaching THIS device. Called on an explicit sign-out only, never
 * on app close — closing the app must not stop notifications.
 */
export async function unregisterPush() {
  if (!isNativeApp() || !currentToken) return;
  const token = currentToken;
  currentToken = null;
  try {
    await api.delete(`/devices/${encodeURIComponent(token)}`);
  } catch {
    /* best effort — the server also re-homes a token on the next sign-in */
  }
}

export default startPush;
