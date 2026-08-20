import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import ErrorBoundary from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
