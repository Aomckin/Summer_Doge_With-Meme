import { describe, expect, it } from "vitest";
import { cloneHistoryState, MEME_MAKER_HISTORY_LIMIT, MemeMakerHistory, type MemeMakerHistoryState } from "./meme-maker-history";
import type { MemeTextBox } from "./meme-renderer";

const box = (fontSize: number): MemeTextBox => ({
  id: "box", text: "A", xPercent: 50, yPercent: 50, widthPercent: 50, fontSize,
  fillColor: "white", strokeWidth: 3, strokeColor: "black", align: "center", fontPreset: "classic",
  fontWeight: "heavy", lineHeight: 1.15, letterSpacing: 0, backgroundEnabled: false, backgroundColor: "#000000",
  backgroundOpacity: .7, backgroundPadding: 12, backgroundRadius: 8, shadowEnabled: false, shadowColor: "#000000",
  shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2,
});
const state = (fontSize: number, title = "Title"): MemeMakerHistoryState => ({
  textBoxes: [box(fontSize)], selectedTextBoxId: "box", title,
  canvasState: { aspectPreset: "original", outputWidth: 800, outputHeight: 600, backgroundScale: 1, backgroundOffsetX: 0, backgroundOffsetY: 0, lockAspectRatio: true, canvasBackgroundColor: "#ffffff" },
});

describe("Meme Maker history", () => {
  it("undoes, redoes and invalidates redo after a branch edit", () => {
    const history = new MemeMakerHistory();
    history.record(state(20), state(30));
    expect(history.undo(state(30))).toEqual(state(20));
    expect(history.redo(state(20))).toEqual(state(30));
    history.undo(state(30));
    history.record(state(20), state(40));
    expect(history.canRedo).toBe(false);
  });

  it("deep-clones snapshots so later mutations do not pollute history", () => {
    const history = new MemeMakerHistory();
    const before = state(20);
    history.record(before, state(30));
    before.textBoxes[0].fontSize = 999;
    expect(history.undo(state(30))?.textBoxes[0].fontSize).toBe(20);
    const cloned = cloneHistoryState(state(20));
    cloned.textBoxes[0].text = "changed";
    expect(state(20).textBoxes[0].text).toBe("A");
    cloned.canvasState.backgroundOffsetX = 99;
    expect(state(20).canvasState.backgroundOffsetX).toBe(0);
  });

  it("keeps only the latest 50 steps and ignores no-op records", () => {
    const history = new MemeMakerHistory();
    expect(history.record(state(1), state(1))).toBe(false);
    for (let index = 0; index < MEME_MAKER_HISTORY_LIMIT + 5; index += 1) history.record(state(index), state(index + 1));
    expect(history.undoCount).toBe(MEME_MAKER_HISTORY_LIMIT);
    let current = state(MEME_MAKER_HISTORY_LIMIT + 5);
    for (let index = 0; index < MEME_MAKER_HISTORY_LIMIT; index += 1) current = history.undo(current)!;
    expect(current.textBoxes[0].fontSize).toBe(5);
    expect(history.undo(current)).toBeNull();
  });
});
