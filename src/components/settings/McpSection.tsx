import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../../lib/tauri";
import { api, type McpStatus } from "../../lib/tauri";
import { isAndroid } from "../../lib/platform";
import type { ApplySettings } from "./types";

const MCP_PORT_DEFAULT = 7373;
const MCP_PORT_MIN = 1024;
const MCP_PORT_MAX = 65535;

type Props = { settings: Settings; applySettings: ApplySettings };

function clampPort(n: number): number {
  return Math.min(MCP_PORT_MAX, Math.max(MCP_PORT_MIN, Math.round(n)));
}

export function McpSection({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  const [android, setAndroid] = useState(false);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [portDraft, setPortDraft] = useState(String(settings.mcp_port ?? MCP_PORT_DEFAULT));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const enabled = settings.mcp_enabled ?? false;
  const token = settings.mcp_token ?? "";
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
    setPortDraft(String(port));
  }, [port]);

  if (android) return null;

  const statusLabel = (() => {
    const kind = status?.status ?? (enabled ? "error" : "off");
    switch (kind) {
      case "listening":
        return t("settings.mcp.statusListening", { port });
      case "port_in_use":
        return t("settings.mcp.statusPortInUse", { message: status?.message ?? "" });
      case "error":
        return t("settings.mcp.statusError", { message: status?.message ?? "" });
      default:
        return t("settings.mcp.statusOff");
    }
  })();

  const copyConfig = async () => {
    if (!token) return;
    const json = JSON.stringify({
      mcpServers: {
        pansuthong: {
          url: `http://127.0.0.1:${port}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }, null, 2);
    await navigator.clipboard.writeText(json);
  };

  const onToggle = async (on: boolean) => {
    setErr(null);
    await applySettings({ mcp_enabled: on });
    await refreshStatus();
  };

  const commitPort = async () => {
    const n = clampPort(Number(portDraft));
    setPortDraft(String(n));
    if (n === port) return;
    setErr(null);
    await applySettings({ mcp_port: n });
    await refreshStatus();
  };

  const onRegenerate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.regenerateMcpToken();
      await refreshStatus();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h2>{t("settings.mcp.title")}</h2>
      <p className="view-sub">{t("settings.mcp.sub")}</p>

      {err && <p className="composer-error" role="alert">{err}</p>}

      <label className="te-field te-field-row">
        <span>{t("settings.mcp.enable")}</span>
        <button
          type="button"
          className={`theme-option ${enabled ? "active" : ""}`}
          aria-pressed={enabled}
          onClick={() => { void onToggle(!enabled); }}
        >
          {enabled ? t("settings.mcp.on") : t("settings.mcp.off")}
        </button>
      </label>

      <label className="te-field">
        <span>{t("settings.mcp.port")}</span>
        <input
          type="number"
          className="text-input"
          min={MCP_PORT_MIN}
          max={MCP_PORT_MAX}
          value={portDraft}
          disabled={!enabled}
          onChange={e => setPortDraft(e.currentTarget.value)}
          onBlur={() => { void commitPort(); }}
        />
      </label>

      <label className="te-field">
        <span>{t("settings.mcp.token")}</span>
        <div className="mcp-token-row">
          <input
            type={showToken ? "text" : "password"}
            className="text-input"
            readOnly
            value={token || "—"}
            aria-label={t("settings.mcp.token")}
          />
          <button type="button" className="btn-secondary" disabled={!token} onClick={() => setShowToken(v => !v)}>
            {showToken ? t("settings.mcp.hide") : t("settings.mcp.show")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!token}
            onClick={() => { void navigator.clipboard.writeText(token); }}
          >
            {t("settings.mcp.copyToken")}
          </button>
        </div>
      </label>

      <div className="settings-actions">
        <button type="button" className="btn-secondary" disabled={!enabled || busy} onClick={() => { void onRegenerate(); }}>
          {t("settings.mcp.regenerate")}
        </button>
        <button type="button" className="btn-secondary" disabled={!enabled || !token} onClick={() => { void copyConfig(); }}>
          {t("settings.mcp.copyConfig")}
        </button>
      </div>

      <p className="view-sub" role="status">{statusLabel}</p>
    </section>
  );
}
