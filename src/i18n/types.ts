export type LanguageId = "es" | "en" | "zh" | "de" | "fr" | "it" | "pt";

export interface LanguageOption {
  id: LanguageId;
  name: string;
  nativeName: string;
  flag: string;
}

export const LANGUAGE_LIST: LanguageOption[] = [
  { id: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { id: "en", name: "English", nativeName: "English", flag: "🇺🇸" },
  { id: "zh", name: "Chinese (Simplified)", nativeName: "简体中文", flag: "🇨🇳" },
  { id: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { id: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { id: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { id: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹" },
];

export interface TranslationSchema {
  common: {
    save: string;
    cancel: string;
    confirm: string;
    delete: string;
    close: string;
    copy: string;
    copied: string;
    loading: string;
    error: string;
    success: string;
    refresh: string;
    clean: string;
    add: string;
    edit: string;
    view: string;
    active: string;
    inactive: string;
  };
  header: {
    searchPlaceholder: string;
    searchKbd: string;
    addFolder: string;
    cleanWorkspace: string;
    workspaceDirs: string;
    selectTheme: string;
    selectLanguage: string;
    chatHistory: string;
    settings: string;
    toggleExplorer: string;
    togglePanel: string;
    newChat: string;
  };
  workspace: {
    masterChat: string;
    newChat: string;
    newChatTooltip: string;
    splitView: string;
    zenMode: string;
    emptyEditorHint: string;
    unsavedChanges: string;
    closeTab: string;
  };
  chat: {
    readyHint: string;
    notReadyHint: string;
    inputPlaceholderAct: string;
    inputPlaceholderPlan: string;
    send: string;
    stop: string;
    planMode: string;
    actMode: string;
    thinking: string;
    toolsExecuted: string;
    toolsRunning: string;
    clearChat: string;
    copyChat: string;
    exportChat: string;
    autoTest: string;
    newConversation: string;
    rulesActive: string;
    reasoningEffort: string;
    lowEffort: string;
    mediumEffort: string;
    highEffort: string;
    tokensUsed: string;
    costUsd: string;
    sessionTitle: string;
  };
  git: {
    title: string;
    branch: string;
    newBranch: string;
    createBranch: string;
    branchNamePlaceholder: string;
    changes: string;
    history: string;
    remotes: string;
    stagedFiles: string;
    unstagedFiles: string;
    stageAll: string;
    unstageAll: string;
    discardFile: string;
    discardConfirm: string;
    commitPlaceholder: string;
    commitBtn: string;
    push: string;
    pull: string;
    fetch: string;
    initTitle: string;
    initDesc: string;
    initBtn: string;
    connectedRemotes: string;
    connectRemoteTitle: string;
    remoteName: string;
    remoteUrl: string;
    saveRemoteBtn: string;
    cleanTree: string;
    noStaged: string;
  };
  settings: {
    title: string;
    providers: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    models: string;
    modelPlaceholder: string;
    contextWindow: string;
    savedSecurely: string;
    systemPrompt: string;
    theme: string;
    language: string;
    saveSettings: string;
  };
  analytics: {
    title: string;
    totalInput: string;
    totalOutput: string;
    totalCached: string;
    totalCost: string;
    cacheHitRatio: string;
    surgicalEfficiency: string;
    compactionRatio: string;
    modelUsage: string;
    turns: string;
  };
  palette: {
    searchPlaceholder: string;
    actionCategory: string;
    themeCategory: string;
    fileCategory: string;
    noResults: string;
    actionOnboarding: string;
    actionAutoTest: string;
    actionToggleMode: string;
    actionTerminal: string;
    actionExplorer: string;
    actionGit: string;
    actionAnalytics: string;
    actionSettings: string;
    actionAddFolder: string;
    actionNewWs: string;
    actionClearChat: string;
    actionHistory: string;
  };
}
