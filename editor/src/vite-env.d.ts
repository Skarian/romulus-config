/// <reference types="vite/client" />

declare module "virtual:romulus-editor-state" {
  import type { EditorState } from "./types";

  const editorState: EditorState;
  export default editorState;
}
