import { useContext } from "react";
import HomeContext from "../context";

function ConnectionStatus() {
    const { isConnected, isReconnecting, isSyncing, offlineQueue } = useContext(HomeContext);
    const pendingCount = offlineQueue.length;

    // ── Syncing (reconnected but replaying queue) ────────────
    if (isConnected && isSyncing) {
        return (
            <div className="connection-status syncing">
                <span className="status-dot pulse" />
                <span>Syncing {pendingCount} change{pendingCount !== 1 ? "s" : ""}…</span>
            </div>
        );
    }

    // ── Fully connected, nothing pending ─────────────────────
    if (isConnected && pendingCount === 0) {
        return (
            <div className="connection-status connected">
                <span className="status-dot" />
                <span>Connected</span>
            </div>
        );
    }

    // ── Connected but prior queue still being cleared ────────
    if (isConnected && pendingCount > 0) {
        return (
            <div className="connection-status connected">
                <span className="status-dot" />
                <span>Connected</span>
            </div>
        );
    }

    // ── Actively trying to reconnect ──────────────────────────
    if (isReconnecting) {
        return (
            <div className="connection-status reconnecting">
                <span className="status-dot pulse" />
                <span>Reconnecting…</span>
                {pendingCount > 0 && (
                    <span className="queue-badge" title="Changes saved locally — will sync on reconnect">
                        {pendingCount} pending
                    </span>
                )}
            </div>
        );
    }

    // ── Offline ───────────────────────────────────────────────
    return (
        <div className="connection-status disconnected">
            <span className="status-dot" />
            {pendingCount > 0 ? (
                <>
                    <span>Offline</span>
                    <span
                        className="queue-badge"
                        title="Changes saved to your device — will sync when reconnected"
                    >
                        {pendingCount} change{pendingCount !== 1 ? "s" : ""} pending
                    </span>
                </>
            ) : (
                <span>Offline — read only</span>
            )}
        </div>
    );
}

export default ConnectionStatus;
