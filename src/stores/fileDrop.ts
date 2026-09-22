import { create } from "zustand";

interface FileDropState {
  /** Terminal leaf currently under an OS file drag, for hover highlight. */
  targetLeafId: string | null;
  setTargetLeafId: (leafId: string | null) => void;
}

export const useFileDropStore = create<FileDropState>((set) => ({
  targetLeafId: null,
  setTargetLeafId: (leafId) =>
    set((state) => (state.targetLeafId === leafId ? state : { targetLeafId: leafId })),
}));
