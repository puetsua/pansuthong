import { Attachment } from "../../lib/tauri";

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|webp)$/i;

/** Managed attachment path the markdown renderers may resolve via the asset protocol. */
export function isManagedAttachmentPath(ref: string): boolean {
  return /^(attachments_[A-Za-z0-9_-]+\/)?attachment_[^/\\]+$/.test(ref) && !ref.includes("..");
}

export function isImageAttachment(att: Attachment): boolean {
  return att.mime_type?.startsWith("image/") ?? IMAGE_EXT.test(att.name);
}

/** Markdown to embed an attachment: an image renders inline, anything else links. */
export function markdownRefFor(att: Attachment): string {
  const link = `[${att.name}](${att.path})`;
  return isImageAttachment(att) ? `!${link}` : link;
}

/** Fallback name for a pasted clipboard image with no usable filename. */
export function defaultPastedName(mime: string | null): string {
  const ext = mime?.startsWith("image/") ? mime.slice("image/".length) : "bin";
  return `pasted.${ext || "bin"}`;
}
