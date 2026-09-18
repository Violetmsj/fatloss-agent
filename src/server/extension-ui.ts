import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface WebNotification {
  message: string;
  type: "info" | "warning" | "error";
}

/**
 * 为以 print mode 运行的扩展提供无终端 UI。
 * notify 会转发给 Web 流；需要用户交互的方法返回取消/空值，避免误触发 TUI 问卷。
 */
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
