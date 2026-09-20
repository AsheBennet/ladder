import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RATING, pairUpdate, updateRating } from "../src/rating/glicko2.js";

describe("glicko2", () => {
  it("winner rating rises, loser falls", () => {
    const a = { ...DEFAULT_RATING };
    const b = { ...DEFAULT_RATING };
    const next = pairUpdate(a, b, true);
    assert.ok(next.a.mu > a.mu);
    assert.ok(next.b.mu < b.mu);
  });

  it("updateRating is deterministic for fixed inputs", () => {
    const a = updateRating(DEFAULT_RATING, DEFAULT_RATING, 1);
    const b = updateRating(DEFAULT_RATING, DEFAULT_RATING, 1);
    assert.equal(a.mu, b.mu);
    assert.equal(a.phi, b.phi);
    assert.equal(a.sigma, b.sigma);
  });
});
