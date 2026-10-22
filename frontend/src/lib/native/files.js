/* Saving a file, on the web and inside the app (2026-10-22).
 *
 * The web app downloads a file the browser way: a blob URL and a click on an
 * <a download>. Inside the Android and iOS apps that does nothing at all —
 * Capacitor's webview registers no download handler on either platform — so
 * "Download PDF" on an invoice, a Company Brain document and Dex's export were
 * dead buttons on a phone. And a link to a stored file (a bill, a request's
 * attachment, a task's proof) opened the phone's browser, which has no
 * session, so it answered "not signed in".
 *
 * In the app a file goes to the phone's share sheet instead: written to the
 * app's cache (@capacitor/filesystem), then handed to the OS (@capacitor/share)
 * — Save to Files or Drive, or straight to a customer on WhatsApp or mail. The
 * Android FileProvider already exposes the cache (res/xml/file_paths.xml).
 * The web is untouched: same download, same links.
 */
import { toast } from "sonner";
import api, { formatApiError } from "../api";
import { isNativeApp } from "./back";

const safeName = (name) => String(name || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "file";

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** The name the server gave the file (Content-Disposition), else the URL's last part. */
export function nameFrom(headers, url, fallback = "file") {
  const cd = headers?.["content-disposition"] || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch { /* fall through to the plain name */ }
  }
  if (plain) return plain[1];
  const last = String(url || "").split("?")[0].split("/").filter(Boolean).pop();
  return last && last !== "download" ? last : fallback;
}

/** Save a Blob as `filename`: a download in a browser, the share sheet in the app. */
export async function saveFile(blob, filename) {
  const name = safeName(filename);
  if (!isNativeApp()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"), import("@capacitor/share"),
  ]);
  const { uri } = await Filesystem.writeFile({
    path: `downloads/${name}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true,
  });
  try {
    await Share.share({ title: name, files: [uri], dialogTitle: name });
  } catch (e) {
    // Closing the sheet without picking anything is not a failure.
    if (!/cancel/i.test(String(e?.message || e))) throw e;
  }
}

/** A blob error body (responseType "blob") carries the server's JSON detail. */
async function errorText(e, fallback) {
  const body = e?.response?.data;
  if (body instanceof Blob) {
    try { return formatApiError(JSON.parse(await body.text())?.detail) || fallback; } catch { return fallback; }
  }
  return formatApiError(body?.detail) || fallback;
}

/**
 * Fetch a file through the API, signed in, and save it. `url` is an API path
 * ("/invoices/1/pdf") or a full URL to the backend.
 */
export async function downloadFrom(url, filename, { method = "get", data, failed = "Couldn't download that. Try again in a moment." } = {}) {
  try {
    const res = await api.request({ url, method, data, responseType: "blob" });
    await saveFile(res.data, filename || nameFrom(res.headers, url));
    return true;
  } catch (e) {
    toast.error(await errorText(e, failed));
    return false;
  }
}

/**
 * Props for a link to a stored file: a plain new-tab link on the web; in the
 * app, a tap fetches it signed in and opens the share sheet.
 */
export function fileLink(href, filename) {
  if (!isNativeApp()) return { href, target: "_blank", rel: "noopener noreferrer" };
  return {
    href,
    onClick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadFrom(href, filename);
    },
  };
}
