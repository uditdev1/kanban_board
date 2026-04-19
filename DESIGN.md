# Conflict Resolution & Architecture — Design Document

## 1. Overview

A real-time collaborative Kanban board where multiple users can simultaneously create, edit, move, and reorder tasks across three columns (To Do, In Progress, Done). The board uses WebSockets (Socket.IO) for real-time sync and implements version-based Optimistic Concurrency Control (OCC) for conflict resolution.

## 2. Conflict Resolution Strategy

### Approach: Version-Based Optimistic Concurrency Control (OCC)

Every task has a `version` field (integer, starts at 1). Every client mutation includes the `version` the client last observed. The server checks this version atomically inside a Prisma transaction before applying changes.

### How It Works

1. Client reads task at **version N**
2. Client sends a mutation with `version: N`
3. Server runs inside `prisma.$transaction`:
   - Reads the task and checks: `currentVersion === N`?
   - **Match** → Apply the change, increment version to `N+1`, broadcast to all
   - **Mismatch** → Return `{ success: false, conflict }` → handler emits `task:conflict` to the requesting socket

The transaction guarantees atomicity — two simultaneous requests cannot both pass the version check.

### Conflict Scenarios

#### Scenario 1: Concurrent Move + Edit

- **User A** moves Task X to "Done" (changes `column` + `position`)
- **User B** edits Task X's title (changes `title`)

**Resolution: First-Write-Wins + Conflict UI**

The first mutation to arrive matches the version and succeeds. The second mutation arrives with a stale version — the server rejects it and emits `task:conflict` with the current server state. The losing client sees a **GitHub-style conflict resolver modal** showing a side-by-side diff of their change vs. the server state, with "Accept Mine" / "Accept Theirs" buttons.

If "Accept Mine" is chosen, the action is re-emitted using the server's latest version number (so OCC passes on retry).

#### Scenario 2: Concurrent Move + Move

- **User A** moves Task X to "In Progress"
- **User B** moves Task X to "Done"

**Resolution: First-Write-Wins with Notification**

Both moves modify `column` + `position`. The server's version check is atomic within a Prisma transaction:
- The first move matches the version → accepted, version incremented
- The second move has a stale version → rejected via `task:conflict`
- The losing client's conflict resolver modal shows the server's committed column vs. their intended column

Deterministic: whichever request the server processes first wins. Ties are impossible since the version check is atomic.

#### Scenario 3: Concurrent Reorder

- **User A** reorders tasks within the same column
- **User B** adds a new task to the same column

**Resolution: Automatic via Fractional Indexing**

Fractional indexing makes inserts and reorders independent operations. Each task gets a unique lexicographic position string. Adding a new task generates a position at the end (or between two tasks). Reordering generates a new position between two adjacent tasks. Neither operation modifies other tasks' positions, so both succeed without conflict.

## 3. Task Ordering: Fractional Indexing

### Problem

Tasks within a column must be ordered. Naive approaches (array index, integer positions) require O(n) re-indexing when a task is inserted or moved.

### Solution

Each task has a `position` field — a lexicographically sortable string generated using the [`fractional-indexing`](https://www.npmjs.com/package/fractional-indexing) package.

**Example positions**: `"a0"`, `"a1"`, `"aH"`, `"aU"`, `"b0"`

- **Insert between "a0" and "a1"** → generates `"a0V"` (lexically between)
- **Insert at end after "b0"** → generates `"b1"`
- **Insert at start before "a0"** → generates `"Zz"`

**Complexity**: O(1)

**Sorting**: Tasks in a column are sorted by `position` using simple string comparison.

### Trade-off

Fractional index strings can grow long after many insertions between the same two positions. In practice, this is negligible for a Kanban board (strings rarely exceed 10 characters).

## 4. Optimistic UI

The frontend implements optimistic updates:

1. User performs an action (create, edit, move, delete)
2. **UI updates immediately** — no waiting for server response
3. Action is sent to server via WebSocket
4. Server validates and broadcasts the result
5. If **success** → client's optimistic state matches server state (no visual change)
6. If **conflict** → client shows the conflict resolver modal with a side-by-side diff

This ensures the UI feels instant (< 16ms response) while maintaining server-authoritative consistency.

## 5. Offline Support

### Queue & Persistence

Actions performed while offline are stored in a `localStorage`-backed queue (`kanban-offline-queue`). This queue survives tab closures and browser restarts. Tasks created offline are shown optimistically with a "pending" visual indicator.

### Disconnect Timestamp

When the WebSocket disconnects, a timestamp is saved to `localStorage` (`kanban-disconnect-time`). This records the moment the client went offline, creating a "line in the sand" for conflict detection.

### Reconnect Flow

1. Socket reconnects → client emits `board:sync` to request fresh server state
2. Server responds with `board:state` containing all current tasks
3. Client iterates the offline queue and compares each action against the server:
   - **`task:create`** → Always replayed (creates can't conflict)
   - **Task missing from server** → Another user deleted it during the offline period
   - **Server `updatedAt` > disconnect timestamp** → Task was modified while offline → **CONFLICT**
   - **Server `updatedAt` ≤ disconnect timestamp** → No conflict → replay normally
4. Conflicts are shown in the GitHub-style conflict resolver modal
5. Non-conflicting actions are replayed immediately

### Offline Conflict Scenarios

| Your Offline Action | Server State | Result |
|---|---|---|
| Edit task | Task edited by another user | `edit_vs_edit` conflict — side-by-side diff |
| Edit task | Task deleted by another user | `they_deleted_you_edited` conflict — "Re-create" or "Accept Delete" |
| Delete task | Task edited by another user | `you_deleted_they_edited` conflict — "Confirm Delete" or "Keep Edited" |
| Delete task | Task also deleted | No conflict — both agreed |
| Create task | N/A | Always replayed — creates can't conflict |

### GitHub-Style Conflict Resolver

When conflicts are detected, a full-screen modal appears. It cannot be closed until all conflicts are resolved. Each conflict card shows:
- **Conflict kind** (edit vs edit / delete vs edit / edit vs delete)
- **Side-by-side diff** of changed fields (title, description, column)
- **"Accept Mine" / "Accept Theirs"** buttons with context-specific labels

For `edit_vs_edit`: "Accept Mine" re-emits the action with the server's latest version. "Accept Theirs" applies the server state.

For `you_deleted_they_edited`: "Confirm Delete" sends the delete with the server's version. "Keep Edited" restores the task.

For `they_deleted_you_edited`: "Re-create" creates a new task with your edits. "Accept Delete" removes it.

## 6. Architecture

```
┌─────────────────────────────────────────┐
│  Client (React + Socket.IO)             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │ useHome  │ │ Offline  │ │ DnD Kit  ││
│  │ (hook)   │ │ Queue    │ │(Drag/Drop)│
│  └────┬─────┘ └────┬─────┘ └────┬─────┘│
│       └─────────┬──┘             │      │
│            Optimistic UI         │      │
│  ┌─────────────────────────────────────┐│
│  │  ConflictResolver (modal overlay)   ││
│  └─────────────────────────────────────┘│
└──────────────┬───────────────────┘
               │ WebSocket (Socket.IO)
┌──────────────▼──────────────────────────┐
│  Server (Express + Socket.IO)           │
│  ┌──────────┐ ┌──────────┐             │
│  │ Handlers │→│ Services │  ← Business │
│  │(thin+Zod)│ │(OCC+CRUD)│    Logic    │
│  └──────────┘ └────┬─────┘             │
│                     │ Prisma Transactions│
│  ┌──────────────────▼──────────────────┐│
│  │    PostgreSQL (persistent)          ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```
