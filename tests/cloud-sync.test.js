/**
 * Cloud Sync — reconcileDeletedIds
 *
 * Pure-logic test (no DOM, no app import), mirroring the helper added to
 * scripts/storage.js. After a snapshot merge, a record soft-deleted on another
 * device arrives in the deleted* list but importAll never removes from the live
 * store. reconcileDeletedIds returns the live ids to drop — but only when the
 * deletion is at least as recent as the live record's last edit, so a record
 * RESTORED/edited more recently than it was deleted survives (newest action wins).
 *
 * Run with: npm test
 */

// ---------------------------------------------------------------------------
// Replicated logic (keep in sync with scripts/storage.js reconcileDeletedIds)
// ---------------------------------------------------------------------------
function reconcileDeletedIds(liveRecords, deletedRecords) {
  const liveById = new Map((liveRecords || []).map(r => [r.id, r]));
  const toRemove = [];
  for (const d of (deletedRecords || [])) {
    const live = liveById.get(d.id);
    if (!live) continue;
    const delTs  = Number(d.deletedAt) || 0;
    const liveTs = Number(live.updatedAt) || Number(live.createdAt) || 0;
    if (delTs >= liveTs) toRemove.push(d.id);
  }
  return toRemove;
}

describe('reconcileDeletedIds', () => {
  test('removes a live record that was deleted more recently on another device', () => {
    const live    = [{ id: 'a', updatedAt: 100 }];
    const deleted = [{ id: 'a', deletedAt: 200 }];
    expect(reconcileDeletedIds(live, deleted)).toEqual(['a']);
  });

  test('keeps a live record that was restored/edited AFTER it was deleted', () => {
    const live    = [{ id: 'a', updatedAt: 300 }];
    const deleted = [{ id: 'a', deletedAt: 200 }];
    expect(reconcileDeletedIds(live, deleted)).toEqual([]);
  });

  test('boundary: equal timestamps count as deleted (deletion wins on tie)', () => {
    const live    = [{ id: 'a', updatedAt: 200 }];
    const deleted = [{ id: 'a', deletedAt: 200 }];
    expect(reconcileDeletedIds(live, deleted)).toEqual(['a']);
  });

  test('ignores deleted ids that are not in the live store', () => {
    const live    = [{ id: 'a', updatedAt: 100 }];
    const deleted = [{ id: 'z', deletedAt: 999 }];
    expect(reconcileDeletedIds(live, deleted)).toEqual([]);
  });

  test('falls back to createdAt when live record has no updatedAt', () => {
    const live    = [{ id: 'a', createdAt: 500 }];
    const deleted = [{ id: 'a', deletedAt: 400 }];
    expect(reconcileDeletedIds(live, deleted)).toEqual([]); // created after deletion → keep
  });

  test('treats missing/non-numeric deletedAt as 0 (never deletes a real live record)', () => {
    const live    = [{ id: 'a', updatedAt: 100 }];
    const deleted = [{ id: 'a' }, { id: 'a', deletedAt: 'oops' }];
    expect(reconcileDeletedIds(live, deleted)).toEqual([]);
  });

  test('handles multiple records and mixed outcomes', () => {
    const live = [
      { id: 'a', updatedAt: 100 }, // deleted later → remove
      { id: 'b', updatedAt: 300 }, // restored later → keep
      { id: 'c', updatedAt: 100 }, // not deleted → keep
    ];
    const deleted = [
      { id: 'a', deletedAt: 200 },
      { id: 'b', deletedAt: 200 },
    ];
    expect(reconcileDeletedIds(live, deleted).sort()).toEqual(['a']);
  });

  test('empty / nullish inputs are safe', () => {
    expect(reconcileDeletedIds([], [])).toEqual([]);
    expect(reconcileDeletedIds(null, null)).toEqual([]);
    expect(reconcileDeletedIds(undefined, undefined)).toEqual([]);
  });
});
