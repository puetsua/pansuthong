import type { ReactNode } from "react";

/** A titled card of related settings within a category. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-subsection">
      <h3 className="settings-subsection-title">{title}</h3>
      <div className="settings-card">{children}</div>
    </section>
  );
}

type Props = {
  title: string;
  /** One short sentence; clamped to two lines. */
  description?: ReactNode;
  /** The control(s) for this one setting, shown on the right. */
  children?: ReactNode;
  /** Status, warning or error that belongs to this setting, below the row. */
  footer?: ReactNode;
};

/** One setting: name and short description on the left, its control on the right. */
export function SettingRow({ title, description, children, footer }: Props) {
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        <h4>{title}</h4>
        {description && <p className="setting-row-desc">{description}</p>}
      </div>
      {children && <div className="setting-row-control">{children}</div>}
      {footer && <div className="setting-row-footer">{footer}</div>}
    </div>
  );
}
