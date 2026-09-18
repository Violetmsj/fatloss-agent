import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface WebNotification {
  message: string;
  type: "info" | "warning" | "error";
}

export function createWebExtensionUI(onNotify: (notification: WebNotification) => void): ExtensionUIContext {
  const ui = {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: (message: string, type: "info" | "warning" | "error" = "info") => onNotify({ message, type }),
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: async () => undefined,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Web 模式不支持终端主题。" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };

  return ui as unknown as ExtensionUIContext;
}
