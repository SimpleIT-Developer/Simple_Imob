import { test } from "node:test";
import assert from "node:assert/strict";
import { dumpsToDelete, isLockStale } from "./sync-homolog-lib";

test("mantém só os N dumps mais recentes", () => {
  const files = ["imob-2026-10-05T10-00-00-000Z.dump", "imob-2026-10-05T10-20-00-000Z.dump", "imob-2026-10-05T10-10-00-000Z.dump", "outro.txt"];
  assert.deepEqual(dumpsToDelete(files, 2), ["imob-2026-10-05T10-00-00-000Z.dump"]);
  assert.deepEqual(dumpsToDelete(files, 5), []);
});

test("lock de execução anterior expira após o limite (processo travado não bloqueia para sempre)", () => {
  const now = Date.parse("2026-10-05T10:30:00Z");
  assert.equal(isLockStale(Date.parse("2026-10-05T10:25:00Z"), now, 20 * 60_000), false);
  assert.equal(isLockStale(Date.parse("2026-10-05T10:05:00Z"), now, 20 * 60_000), true);
});
