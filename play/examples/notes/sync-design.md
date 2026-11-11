# Sync design

Sync keeps the copy of a note on this device and the copy in the cloud the same.
It never talks to the editor directly: it gives an `Edit`, as the editor does, and
waits for `NoteSaved`.

## The rule

A note is a list of lines. Two edits to **different** lines both apply. Two edits to
the **same** line keep the later one, and the earlier text goes into the note's
history, so nothing a person typed is lost.

> If both devices were offline, "later" is the device clock. That is wrong
> sometimes, which is why the history exists.

## What happens on a pull

1. Fetch the edits made since the last pull.
2. Give each one to Store as an `Edit`.
3. When `NoteSaved` comes back, remember the edit as applied.

```ts
for (const edit of await cloud.since(cursor)) {
  store.take(edit)            // Store answers with NoteSaved
}
```

## Open questions

- [x] Do deletes sync? Yes, as an edit that empties the note.
- [ ] How long is history kept?
- [ ] What does the editor show while a pull is running?

| Case | Result |
| --- | --- |
| Different lines | Both edits apply |
| Same line | Later edit wins, earlier one kept in history |
| Note deleted on one side | Deleted, restorable for 30 days |

More on the approach: https://en.wikipedia.org/wiki/Operational_transformation
