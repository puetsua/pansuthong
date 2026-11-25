import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../../lib/tauri";
import { api, type McpStatus } from "../../lib/tauri";
import { isAndroid } from "../../lib/platform";
import type { ApplySettings } from "./types";
import { ToggleSwitch } from "./ToggleSwitch";
import { SettingRow, SettingsSection } from "./SettingRow";

const MCP_PORT_DEFAULT = 7373;
const MCP_PORT_MIN = 1024;
const MCP_PORT_MAX = 65535;

type Props = { settings: Settings; applySettings: ApplySettings };

export function McpSection({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  const [android, setAndroid] = useState(false);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [portDraft, setPortDraft] = useState(String(settings.mcp_port ?? MCP_PORT_DEFAULT));
  const [portErr, setPortErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const enabled = settings.mcp_enabled ?? false;
  const port = settings.mcp_port ?? MCP_PORT_DEFAULT;

  useEffect(() => { void isAndroid().then(setAndroid); }, []);

  const refreshStatus = useCallback(async () => {
    if (android) return;
    try {
      setStatus(await api.getMcpStatus());
    } catch {
      setStatus(null);
    }
  }, [android]);

  useEffect(() => {
    void refreshStatus();
    if (!enabled || android) return;
    const id = window.setInterval(() => { void refreshStatus(); }, 2000);
    return () => window.clearInterval(id);
  }, [enabled, android, refreshStatus]);

  useEffect(() => {
    if (android) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void api.onMcpStatusChanged(setStatus)
      .then((un) => { if (active) unlisten = un; else un(); })
      .catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, [android]);

  useEffect(() => {
    setPortDraft(String(port));
  }, [port]);

  if (android) return null;

  // Nothing while off; the address (highlighted) while listening. Port in use
  // is shown under the Port setting instead.
  const statusLine = (() => {
    const kind = status?.status ?? (enabled ? "error" : "off");
    switch (kind) {
      case "listening":
        return <p className="settings-status mcp-address" role="status"><code>{`http://127.0.0.1:${port}/mcp`}</code></p>;
      case "error":
        return <p className="settings-warn" role="status">{t("settings.mcp.statusError", { message: status?.message ?? "" })}</p>;
      default:
        return null;
    }
  })();

  // Validation errors take precedence over the runtime "port in use" notice.
  const portNotice = portErr
    ?? (enabled && status?.status === "port_in_use"
      ? t("settings.mcp.statusPortInUse", { message: status.message ?? "" })
      : null);

  const onToggle = async (on: boolean) => {
    setErr(null);
    await applySettings({ mcp_enabled: on });
    await refreshStatus();
  };

  const commitPort = async () => {
    const raw = portDraft.trim();
    if (raw === "") {
      setPortErr(t("settings.mcp.portInvalid", { min: MCP_PORT_MIN, max: MCP_PORT_MAX }));
      return;
    }
    // Digits only: rejects "1e4", "1.0", "+5000" that Number() would accept.
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < MCP_PORT_MIN || n > MCP_PORT_MAX || !Number.isInteger(n)) {
      setPortErr(t("settings.mcp.portInvalid", { min: MCP_PORT_MIN, max: MCP_PORT_MAX }));
      return;
    }
    if (n === port) {
      setPortErr(null);
      return;
    }
    setPortErr(null);
    try {
      await applySettings({ mcp_port: n });
      await refreshStatus();
    } catch (e) {
      setPortErr(String(e));
    }
  };

  return (
    <SettingsSection title={t("settings.mcp.title")}>
      <SettingRow
        title={t("settings.mcp.enable")}
        description={t("settings.mcp.sub")}
        footer={<>
          {err && <p className="composer-error" role="alert">{err}</p>}
          {statusLine}
        </>}
      >
        <ToggleSwitch
          label={t("settings.mcp.enable")}
          checked={enabled}
          onChange={on => { void onToggle(on); }}
        />
      </SettingRow>

      <SettingRow
        title={t("settings.mcp.port")}
        description={t("settings.mcp.portSub")}
        footer={portNotice && (
          <p className="composer-error mcp-port-error" role="alert">{portNotice}</p>
        )}
      >
        <input
          type="text"
          inputMode="numeric"
          className="text-input weight-input"
          aria-label={t("settings.mcp.port")}
          value={portDraft}
          onChange={e => {
            setPortErr(null);
            setPortDraft(e.currentTarget.value);
          }}
          onBlur={() => { void commitPort(); }}
        />
      </SettingRow>
    </SettingsSection>
  );
}
