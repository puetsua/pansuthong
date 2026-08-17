import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, Attachment } from "../../lib/tauri";
import { isAndroid } from "../../lib/platform";
import { isImageAttachment } from "./attachmentRefs";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function AttachmentList({
  attachments,
  onRequestRemove,
  onInsert,
  onOpenImage,
  emptyLabel,
  disabled,
}: {
  attachments: Attachment[];
  onRequestRemove: (att: Attachment) => void;
  onInsert: (att: Attachment) => void;
  onOpenImage: (url: string, alt: string) => void;
  emptyLabel: string;
  disabled: boolean;
}) {
  if (attachments.length === 0) {
    return <p className="te-attachments-empty">{emptyLabel}</p>;
  }
  return (
    <div className="te-attachments">
      {attachments.map(att => (
        <AttachmentItem
          key={att.id}
          attachment={att}
          onRequestRemove={() => onRequestRemove(att)}
          onInsert={() => onInsert(att)}
          onOpenImage={onOpenImage}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function AttachmentItem({
  attachment,
  onRequestRemove,
  onInsert,
  onOpenImage,
  disabled,
}: {
  attachment: Attachment;
  onRequestRemove: () => void;
  onInsert: () => void;
  onOpenImage: (url: string, alt: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setImgFailed(false);
    api.attachmentUrl(attachment.path)
      .then(u => { if (live) { objectUrl = u; setUrl(u); } else URL.revokeObjectURL(u); })
      .catch(() => { if (live) setUrl(null); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.path]);
  const isImage = isImageAttachment(attachment);
  const showImage = isImage && url != null && !imgFailed;
  const [android, setAndroid] = useState(false);
  useEffect(() => { void isAndroid().then(setAndroid); }, []);
  const reveal = () => { void api.revealAttachment(attachment.path); };
  const revealTitle = android
    ? t("taskEditor.saveAttachmentCopy", { name: attachment.name })
    : t("taskEditor.revealAttachment", { name: attachment.name });
  return (
    <div className={showImage ? "te-attachment image" : "te-attachment"}>
      {showImage && (
        <button type="button" className="te-attachment-thumb"
                aria-label={t("taskEditor.enlargeImage", { name: attachment.name })}
                onClick={() => onOpenImage(url!, attachment.name)}>
          <img src={url!} alt={attachment.name} onError={() => setImgFailed(true)} />
        </button>
      )}
      <div className="te-attachment-meta">
        <button type="button" className="te-attachment-name"
                title={revealTitle}
                onClick={reveal}>
          {attachment.name}
        </button>
        {attachment.size != null && <span className="te-attachment-size">{formatBytes(attachment.size)}</span>}
      </div>
      <div className="te-attachment-actions">
        <button type="button" className="te-attachment-insert"
                aria-label={t("taskEditor.insertAttachment", { name: attachment.name })}
                title={t("taskEditor.insertAttachment", { name: attachment.name })}
                onClick={onInsert} disabled={disabled}>↳</button>
        <button type="button" className="te-attachment-delete"
                aria-label={t("taskEditor.removeAttachment", { name: attachment.name })}
                onClick={onRequestRemove} disabled={disabled}>×</button>
      </div>
    </div>
  );
}

export function MarkdownImage({ path, alt, onOpen }: {
  path: string;
  alt: string;
  onOpen: (url: string, alt: string) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setFailed(false);
    api.attachmentUrl(path)
      .then(u => { if (live) { objectUrl = u; setUrl(u); } else URL.revokeObjectURL(u); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  if (failed) {
    return (
      <span className="te-md-image-broken" title={t("taskEditor.imageUnavailable")}>
        🔗💔 {alt || t("taskEditor.imageUnavailable")}
      </span>
    );
  }
  if (url == null) return <span>{alt}</span>;
  return (
    <img className="te-md-image" src={url} alt={alt}
         onClick={() => onOpen(url, alt)}
         onError={() => setFailed(true)} />
  );
}

export function ImageLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="te-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <button type="button" className="te-lightbox-close" aria-label={t("taskEditor.closeImage")}
              onClick={onClose}>×</button>
      <img src={url} alt={alt} onClick={e => e.stopPropagation()} />
    </div>
  );
}
