import { useContext } from "react";
import HomeContext from "../context";
import type { UnresolvedConflict } from "../../../types";
import { COLUMN_LABELS } from "../../../types";

function ConflictResolver() {
    const { unresolvedConflicts, resolveConflict } =
        useContext(HomeContext) as {
            unresolvedConflicts: UnresolvedConflict[];
            resolveConflict: (taskId: string, pick: "mine" | "theirs") => void;
        };

    if (unresolvedConflicts.length === 0) return null;

    return (
        <div className="cr-overlay">
            <div className="cr-backdrop" />

            <div className="cr-container">
                <div className="cr-header">
                    <span className="cr-header-icon">⚡</span>
                    <div>
                        <div className="cr-header-title">
                            {unresolvedConflicts.length} Conflict{unresolvedConflicts.length > 1 ? "s" : ""} Detected
                        </div>
                        <div className="cr-header-sub">
                            Another user modified {unresolvedConflicts.length > 1 ? "these tasks" : "this task"} while
                            you were offline. Choose which version to keep for each conflict below.
                        </div>
                    </div>
                </div>

                <div className="cr-list">
                    {unresolvedConflicts.map((conflict, index) => (
                        <ConflictCard
                            key={conflict.taskId}
                            conflict={conflict}
                            index={index}
                            total={unresolvedConflicts.length}
                            onResolve={resolveConflict}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

interface ConflictCardProps {
    conflict: UnresolvedConflict;
    index: number;
    total: number;
    onResolve: (taskId: string, pick: "mine" | "theirs") => void;
}

function ConflictCard({ conflict, index, total, onResolve }: ConflictCardProps) {
    const { yourVersion, serverVersion, conflictKind } = conflict;

    let subtitle: string;
    let mineLabel: string;
    let mineSub: string;
    let theirsLabel: string;
    let theirsSub: string;
    let cardTitle: string;

    if (conflictKind === "you_deleted_they_edited") {
        cardTitle = serverVersion?.title ?? yourVersion.title;
        subtitle = "You deleted this task offline, but another user edited it";
        mineLabel = "Confirm Delete";
        mineSub = "(Remove)";
        theirsLabel = "Keep Edited";
        theirsSub = "(Restore)";
    } else if (conflictKind === "they_deleted_you_edited") {
        cardTitle = yourVersion.title;
        subtitle = "Another user deleted this task, but you edited it offline";
        mineLabel = "Re-create";
        mineSub = "(My Edits)";
        theirsLabel = "Accept Delete";
        theirsSub = "(Remove)";
    } else {
        cardTitle = serverVersion?.title ?? yourVersion.title;
        subtitle = "Your offline edit conflicts with changes made by another user";
        mineLabel = "Accept Current";
        mineSub = "(Mine)";
        theirsLabel = "Accept Incoming";
        theirsSub = "(Theirs)";
    }

    const diffs: { label: string; yours: string; theirs: string; changed: boolean }[] = [];

    if (conflictKind === "you_deleted_they_edited") {
        diffs.push({
            label: "Action",
            yours: "🗑️ Deleted",
            theirs: serverVersion ? "✏️ Edited" : "—",
            changed: true,
        });
        diffs.push({
            label: "Title",
            yours: "—",
            theirs: serverVersion?.title ?? "—",
            changed: true,
        });
        diffs.push({
            label: "Desc",
            yours: "—",
            theirs: serverVersion?.description || "(empty)",
            changed: true,
        });
        if (serverVersion) {
            diffs.push({
                label: "Column",
                yours: "—",
                theirs: COLUMN_LABELS[serverVersion.column] || serverVersion.column,
                changed: true,
            });
        }
    } else if (conflictKind === "they_deleted_you_edited") {
        diffs.push({
            label: "Action",
            yours: "✏️ Edited",
            theirs: "🗑️ Deleted",
            changed: true,
        });
        diffs.push({
            label: "Title",
            yours: yourVersion.title,
            theirs: "—",
            changed: true,
        });
        diffs.push({
            label: "Desc",
            yours: yourVersion.description || "(empty)",
            theirs: "—",
            changed: true,
        });
        diffs.push({
            label: "Column",
            yours: COLUMN_LABELS[yourVersion.column] || yourVersion.column,
            theirs: "—",
            changed: true,
        });
    } else {
        diffs.push({
            label: "Title",
            yours: yourVersion.title,
            theirs: serverVersion?.title ?? "—",
            changed: yourVersion.title !== serverVersion?.title,
        });
        diffs.push({
            label: "Desc",
            yours: yourVersion.description || "(empty)",
            theirs: serverVersion?.description || "(empty)",
            changed: yourVersion.description !== serverVersion?.description,
        });
        if (yourVersion.column !== serverVersion?.column) {
            diffs.push({
                label: "Column",
                yours: COLUMN_LABELS[yourVersion.column] || yourVersion.column,
                theirs: serverVersion ? (COLUMN_LABELS[serverVersion.column] || serverVersion.column) : "—",
                changed: true,
            });
        }
    }

    return (
        <div className="cr-card">
            <div className="cr-card-header">
                <div className="cr-card-title">
                    <span className="cr-icon">⚠️</span>
                    <div>
                        <span className="cr-badge">
                            Conflict {index + 1} of {total}
                        </span>
                        <div className="cr-task-name">{cardTitle}</div>
                        <div className="cr-subtitle">{subtitle}</div>
                    </div>
                </div>
            </div>

            <div className="cr-columns-header">
                <div className="cr-col-label cr-col-label--yours">
                    <span className="cr-col-dot cr-col-dot--yours" />
                    Current Change (Yours)
                </div>
                <div className="cr-col-label cr-col-label--theirs">
                    <span className="cr-col-dot cr-col-dot--theirs" />
                    Incoming Change (Theirs)
                </div>
            </div>

            <div className="cr-diffs">
                {diffs.map((diff) => (
                    <div
                        key={diff.label}
                        className={`cr-diff-row ${diff.changed ? "cr-diff-row--changed" : ""}`}
                    >
                        <div className="cr-diff-label">{diff.label}</div>
                        <div className="cr-diff-values">
                            <div
                                className={`cr-diff-value cr-diff-value--yours ${diff.changed ? "cr-diff-highlight" : ""}`}
                            >
                                {diff.yours || <span className="cr-diff-empty">empty</span>}
                            </div>
                            <div
                                className={`cr-diff-value cr-diff-value--theirs ${diff.changed ? "cr-diff-highlight" : ""}`}
                            >
                                {diff.theirs || <span className="cr-diff-empty">empty</span>}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="cr-actions">
                <button
                    className="cr-btn cr-btn--mine"
                    onClick={() => onResolve(conflict.taskId, "mine")}
                >
                    <span className="cr-btn-icon">✓</span>
                    {mineLabel}
                    <span className="cr-btn-sub">{mineSub}</span>
                </button>

                <span className="cr-actions-divider">or</span>

                <button
                    className="cr-btn cr-btn--theirs"
                    onClick={() => onResolve(conflict.taskId, "theirs")}
                >
                    <span className="cr-btn-icon">↓</span>
                    {theirsLabel}
                    <span className="cr-btn-sub">{theirsSub}</span>
                </button>
            </div>
        </div>
    );
}

export default ConflictResolver;
