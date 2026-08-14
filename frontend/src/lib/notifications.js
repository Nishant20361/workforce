import { adminApi, workerApi } from "@/lib/api";

const publicKey = process.env.REACT_APP_VAPID_PUBLIC_KEY;

function keyBytes(value) {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export const pushSupported = () => Boolean(publicKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);

export async function enablePushNotifications(isAdmin) {
  if (!pushSupported()) throw new Error("Push notifications are unavailable in this browser or not configured yet.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.register("/service-worker.js");
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
  await (isAdmin ? adminApi : workerApi).post("/push/subscribe", subscription.toJSON());
}

export function updateAppBadge(count) {
  const unread = Math.max(0, Number(count) || 0);
  if (unread > 0 && typeof navigator.setAppBadge === "function") navigator.setAppBadge(unread).catch(() => {});
  if (unread === 0 && typeof navigator.clearAppBadge === "function") navigator.clearAppBadge().catch(() => {});
}
