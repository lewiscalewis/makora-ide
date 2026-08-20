import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Copy, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[MakoraIDE ErrorBoundary caught error]:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleCopyDiagnostics = () => {
    const { error, errorInfo } = this.state;
    const diagnosticText = `MakoraIDE v1.0 Diagnostic Report\nError: ${error?.toString()}\nComponent Stack:\n${errorInfo?.componentStack || "N/A"}`;
    navigator.clipboard.writeText(diagnosticText).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleSafeReset = () => {
    try {
      // Clear transient active state without deleting persisted sessions
      localStorage.removeItem("makora.activeSession");
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen" role="alert">
          <div className="error-boundary-card">
            <div className="error-boundary-header">
              <div className="error-boundary-icon-wrap">
                <ShieldAlert size={28} className="text-red" />
              </div>
              <div className="error-boundary-title-col">
                <h2>Se ha producido un error inesperado en la interfaz</h2>
                <p className="muted text-sm">
                  MakoraIDE ha aislado el fallo para proteger la integridad de tus archivos y configuraciones.
                </p>
              </div>
            </div>

            <div className="error-boundary-body">
              <div className="error-boundary-message-box">
                <AlertTriangle size={16} className="text-gold flex-shrink-0" />
                <span className="font-mono text-xs text-red">
                  {this.state.error?.message || "Error desconocido en el renderizado"}
                </span>
              </div>

              {this.state.errorInfo?.componentStack && (
                <details className="error-boundary-details">
                  <summary className="cursor-pointer text-xs muted font-mono">
                    Ver traza técnica del componente
                  </summary>
                  <pre className="error-boundary-stack font-mono">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>

            <div className="error-boundary-footer">
              <button
                type="button"
                className="btn btn-subtle"
                onClick={this.handleCopyDiagnostics}
              >
                <Copy size={13} />
                <span>{this.state.copied ? "Diagnóstico copiado" : "Copiar diagnóstico"}</span>
              </button>

              <div className="error-boundary-action-group">
                <button
                  type="button"
                  className="btn btn-subtle"
                  onClick={this.handleSafeReset}
                  title="Reinicia la ventana enfocando una sesión limpia"
                >
                  <RotateCcw size={13} />
                  <span>Modo seguro</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={this.handleReload}
                >
                  <RefreshCw size={13} />
                  <span>Recargar IDE</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
