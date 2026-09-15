/* ASK-25 — a person's face, wherever a person is named.

   PersonAvatar is the photo a member set on Team, or their initials until
   they do. AvatarStack is the "who is on this" cluster at the bottom-right of
   a My Work card: two faces, and a third circle reading +N for the rest.

   `avatar_url` is stored as a same-origin path (/api/files/<id>/download) and
   served on the auth cookie, so production needs nothing added to it. Local
   dev points REACT_APP_BACKEND_URL at the API on another port, which is the
   same prefix task attachments already take. */
import { Avatar, AvatarImage, AvatarFallback } from "../ui/avatar";
import { UsersThree } from "@phosphor-icons/react";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "";

export const avatarSrc = (url) =>
  !url ? undefined : /^(https?:|data:|blob:)/.test(url) ? url : `${BACKEND}${url}`;

export function initialsOf(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

const box = (size) => ({ width: size, height: size });
const type = (size) => ({ fontSize: Math.max(9, Math.round(size * 0.36)) });

export function PersonAvatar({ name, src, size = 28, ring = true, className = "" }) {
  return (
    /* Keyed on the photo. Radix keeps the image's "loaded" status on the root
       after the image itself unmounts, so removing a photo left an empty
       circle with the initials still hidden behind it (measured: fallback
       text "" after DELETE). A new key is a fresh root with no memory. */
    <Avatar key={src || "no-photo"} style={box(size)} className={`bg-slate-200 ${ring ? "ring-2 ring-[#fff]" : ""} ${className}`}>
      {src && <AvatarImage src={avatarSrc(src)} alt={name || ""} className="object-cover" />}
      {/* With a photo on file the initials wait 600ms, so a fast load never
          flashes letters first; a slow or broken one still gets them. */}
      <AvatarFallback delayMs={src ? 600 : 0} style={type(size)}
        className="bg-slate-200 font-semibold text-slate-600">
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/* people: [{ id, name, avatar_url }] — or { kind: "team", name } for a task
   handed to a role with nobody named yet, which gets a group glyph instead of
   pretending to be a person. */
export function AvatarStack({ people = [], max = 2, size = 28, testid }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const names = people.map((p) => p.name).filter(Boolean).join(", ");
  return (
    <div role="img" aria-label={`Assigned to ${names}`} title={names}
      data-testid={testid} data-count={people.length}
      className="flex shrink-0 items-center -space-x-2">
      {shown.map((p, i) => (p.kind === "team" ? (
        <span key={p.id || i} style={box(size)}
          className="relative grid shrink-0 place-items-center rounded-full bg-slate-200 text-slate-600 ring-2 ring-[#fff]">
          <UsersThree size={Math.round(size * 0.5)} weight="bold" aria-hidden="true" />
        </span>
      ) : (
        <PersonAvatar key={p.id || i} name={p.name} src={p.avatar_url} size={size} />
      )))}
      {extra > 0 && (
        <span style={{ ...box(size), ...type(size) }}
          className="relative grid shrink-0 place-items-center rounded-full bg-slate-100 font-semibold tabular-nums text-slate-600 ring-2 ring-[#fff]">
          +{extra}
        </span>
      )}
    </div>
  );
}
