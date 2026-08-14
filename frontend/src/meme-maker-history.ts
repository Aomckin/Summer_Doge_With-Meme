import type { MemeTextBox } from "./meme-renderer";
import type { MemeCanvasState } from "./meme-background";
import type { MemeImageLayer } from "./meme-image-layer";

export interface MemeMakerHistoryState {
  textBoxes: MemeTextBox[];
  imageLayers: MemeImageLayer[];
  selectedTextBoxId: string | null;
  selectedImageLayerId: string | null;
  title: string;
  canvasState: MemeCanvasState;
  backgroundVisible: boolean;
}

export const MEME_MAKER_HISTORY_LIMIT = 50;

export function cloneHistoryState(state: MemeMakerHistoryState): MemeMakerHistoryState {
  return {
    textBoxes: state.textBoxes.map(box => ({ ...box })),
    imageLayers: state.imageLayers.map(layer => ({ ...layer })),
    selectedTextBoxId: state.selectedTextBoxId,
    selectedImageLayerId: state.selectedImageLayerId,
    title: state.title,
    canvasState: { ...state.canvasState },
    backgroundVisible: state.backgroundVisible,
  };
}

export function historyStatesEqual(left: MemeMakerHistoryState, right: MemeMakerHistoryState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class MemeMakerHistory {
  private undoStack: MemeMakerHistoryState[] = [];
  private redoStack: MemeMakerHistoryState[] = [];

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoCount(): number { return this.undoStack.length; }

  clear(): void { this.undoStack = []; this.redoStack = []; }

  record(previous: MemeMakerHistoryState, current: MemeMakerHistoryState): boolean {
    if (historyStatesEqual(previous, current)) return false;
    this.undoStack.push(cloneHistoryState(previous));
    if (this.undoStack.length > MEME_MAKER_HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  undo(current: MemeMakerHistoryState): MemeMakerHistoryState | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(cloneHistoryState(current));
    return cloneHistoryState(previous);
  }

  redo(current: MemeMakerHistoryState): MemeMakerHistoryState | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneHistoryState(current));
    return cloneHistoryState(next);
  }
}
