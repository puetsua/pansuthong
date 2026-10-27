import { Children, isValidElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import type { Position } from "unist";
import { api } from "../../lib/tauri";
import { toggleTaskListMarker } from "../../lib/markdownTaskList";
import { isManagedAttachmentPath } from "./attachmentRefs";
import { MarkdownImage } from "./attachments";

type BuildMarkdownComponentsOptions = {
  notes: string;
  attachmentPaths: Set<string>;
  onNotesChange: (value: string) => void;
  openImage: (url: string, alt: string) => void;
  t: (key: string, options?: Record<string, string>) => string;
};

export function buildMarkdownNotesComponents({
  notes,
  attachmentPaths,
  onNotesChange,
  openImage,
  t,
}: BuildMarkdownComponentsOptions): Components {
  const toggleAt = (position: Position) => {
    onNotesChange(toggleTaskListMarker(notes, position));
  };

  return {
    li({ node, className, children, ...props }) {
      const classText = Array.isArray(className) ? className.join(" ") : className;
      const isTask = typeof classText === "string" && classText.includes("task-list-item");
      if (!isTask || !node?.position) {
        return <li className={className} {...props}>{children}</li>;
      }

      let checked = false;
      const body: ReactNode[] = [];
      Children.forEach(children, child => {
        if (isValidElement(child) && child.type === "input"
          && (child.props as { type?: string }).type === "checkbox") {
          checked = !!(child.props as { checked?: boolean }).checked;
          return;
        }
        body.push(child);
      });

      return (
        <li className={className} {...props}>
          <input
            type="checkbox"
            className="te-md-task-check"
            checked={checked}
            onChange={() => toggleAt(node.position!)}
          />
          {body}
        </li>
      );
    },
    img: ({ src, alt }) => {
      const label = alt ?? "";
      if (typeof src !== "string" || !isManagedAttachmentPath(src)) return <span>{label}</span>;
      if (!attachmentPaths.has(src)) {
        return (
          <span className="te-md-image-broken" title={t("taskEditor.imageUnavailable")}>
            🔗💔 {label || t("taskEditor.imageUnavailable")}
          </span>
        );
      }
      return <MarkdownImage path={src} alt={label} onOpen={openImage} />;
    },
    a: ({ href, children }) => {
      if (typeof href !== "string" || !isManagedAttachmentPath(href)) {
        return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      }
      if (!attachmentPaths.has(href)) {
        return <span className="te-md-image-broken" title={t("taskEditor.imageUnavailable")}>🔗💔 {children}</span>;
      }
      return <a href="#" onClick={e => { e.preventDefault(); void api.openAttachment(href); }}>{children}</a>;
    },
  };
}

export const markdownNotesElements = [
  "a", "blockquote", "br", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "img", "input", "li", "ol", "p", "pre", "strong", "ul",
] as const;
