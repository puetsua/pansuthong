## Context

Attachments merge by id union today. Entity tombstones already exist for tasks/tags/templates and are stored in SQLite `tombstones` with a `kind` column.

## Goals / Non-Goals

**Goals:** Propagate attachment deletes via tombstones; GC unreferenced blobs after merge.

**Non-Goals:** Moving blobs into SQLite; changing SAF mirror (#120/#122); history merge (#124).

## Decisions

### D1: Document-level `deleted_attachments: Vec<Tombstone>`

Same shape as `deleted_tasks`. Attachment ids are globally unique. SQLite: `kind = "attachment"` in existing table — no schema migration.

### D2: Suppress using `created_at` as recreate stamp

Keep attachment if no tombstone, or if `attachment.created_at > tombstone.deleted_at` (re-add after delete). Otherwise strip from merged task/template.

### D3: Opportunistic path-based GC

Delete a managed blob when the merged Document has no live attachment with that `path`. Run after local remove and after `reload_replicas_if_changed` when the document changed. Any device may delete unreferenced blobs in the shared folder (including peer `attachments_*` dirs). Do not require a tombstone for GC — tombstones only make refs disappear across replicas.

## Risks / Trade-offs

- [Clock skew on created_at vs deleted_at] → Same as entity tombstones; accept
- [Aggressive GC deletes peer blob before peer sees tombstone] → Peer still has metadata until merge; if we delete blob early, peer's open fails until they merge tombstone — acceptable for sync folders; only delete when unreferenced in *this* device's merged view after merge includes tombstones

## Migration Plan

Additive field + new tombstone kind. Old apps ignore unknown tombstone kinds in DB? Old apps don't read attachment kind — they only read task/tag/template. New field in JSON default empty. No version bump required (additive); optionally bump to 11 for documentation — prefer no bump to match "optional fields don't need migration".

## Open Questions

None.
