import React, { useState, useEffect } from 'react';
import { AlertTriangle, AlertCircle, X, Database, RefreshCw, ChevronRight } from 'lucide-react';
import { SchemaAlert, getRecentSchemaAlerts, subscribeToSchemaAlerts } from '../utils/firestoreSchemaValidator';

interface FirestoreSchemaAlertBannerProps {
  isAdmin?: boolean;
}

export const FirestoreSchemaAlertBanner: React.FC<FirestoreSchemaAlertBannerProps> = ({ isAdmin = false }) => {
  const [alerts, setAlerts] = useState<SchemaAlert[]>(() => getRecentSchemaAlerts());
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [selectedAlert, setSelectedAlert] = useState<SchemaAlert | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToSchemaAlerts((newAlert) => {
      setAlerts((prev) => [newAlert, ...prev.filter((a) => a.id !== newAlert.id)]);
      setIsDismissed(false);
    });

    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent<SchemaAlert>).detail;
      if (detail) {
        setAlerts((prev) => [detail, ...prev.filter((a) => a.id !== detail.id)]);
        setIsDismissed(false);
      }
    };

    window.addEventListener('firestore-schema-alert', handleCustomEvent);
    return () => {
      unsubscribe();
      window.removeEventListener('firestore-schema-alert', handleCustomEvent);
    };
  }, []);

  // Only render if there are alerts and either admin or in local/dev environment
  const isDev = Boolean(import.meta.env.DEV) || window.location.hostname === 'localhost' || isAdmin;
  if (!isDev || alerts.length === 0 || isDismissed) {
    return null;
  }

  const latestAlert = alerts[0];
  const isCritical = latestAlert.level === 'critical';
  const isMigration = latestAlert.level === 'migration_required';

  return (
    <>
      <aside aria-label="Firestore Schema Alert" className={`fixed bottom-4 right-4 z-50 max-w-lg w-full rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-300 p-4 ${
        isCritical
          ? 'bg-red-950/95 border-red-500/50 text-red-100'
          : isMigration
          ? 'bg-amber-950/95 border-amber-500/50 text-amber-100'
          : 'bg-slate-900/95 border-sky-500/50 text-slate-100'
      }`}>
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl shrink-0 ${
            isCritical ? 'bg-red-500/20 text-red-400' : isMigration ? 'bg-amber-500/20 text-amber-400' : 'bg-sky-500/20 text-sky-400'
          }`}>
            {isCritical ? <AlertCircle className="w-5 h-5 animate-pulse" /> : <Database className="w-5 h-5" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                isCritical
                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                  : isMigration
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
              }`}>
                {isCritical ? 'Alerta Crítico de Esquema' : isMigration ? 'Migração de Esquema Necessária' : 'Aviso de Esquema'}
              </span>
              <button
                onClick={() => setIsDismissed(true)}
                className="text-white/60 hover:text-white transition-colors p-1"
                title="Fechar alerta"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="mt-1 text-sm font-semibold truncate">
              {latestAlert.path}: {latestAlert.message}
            </p>

            {latestAlert.migrationAdvice && (
              <p className="mt-1 text-xs text-amber-300/90 bg-black/30 p-2 rounded-lg font-mono">
                {latestAlert.migrationAdvice}
              </p>
            )}

            <div className="mt-3 flex items-center justify-between text-xs text-white/70">
              <span>Total de avisos: {alerts.length}</span>
              <button
                onClick={() => setSelectedAlert(latestAlert)}
                className="inline-flex items-center gap-1 font-medium underline hover:text-white"
              >
                Inspecionar Detalhes <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Detail Modal for Developer Inspection */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-700 text-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-lg text-slate-100">Validação Estrutural Cloud Firestore</h3>
              </div>
              <button
                onClick={() => setSelectedAlert(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs uppercase text-slate-400 font-bold">Caminho do Documento:</span>
                <p className="font-mono text-xs bg-slate-950 p-2 rounded-lg text-amber-300 mt-1">
                  {selectedAlert.path}
                </p>
              </div>

              <div>
                <span className="text-xs uppercase text-slate-400 font-bold">Diagnóstico:</span>
                <p className="text-slate-200 mt-1">{selectedAlert.message}</p>
              </div>

              {selectedAlert.migrationAdvice && (
                <div>
                  <span className="text-xs uppercase text-slate-400 font-bold">Instrução de Migração:</span>
                  <div className="bg-amber-950/40 border border-amber-600/30 p-3 rounded-lg text-amber-200 text-xs font-mono mt-1">
                    {selectedAlert.migrationAdvice}
                  </div>
                </div>
              )}

              {selectedAlert.details && (
                <div>
                  <span className="text-xs uppercase text-slate-400 font-bold">Dados do Alerta:</span>
                  <pre className="max-h-48 overflow-auto bg-slate-950 p-3 rounded-lg text-xs font-mono text-slate-300 mt-1">
                    {JSON.stringify(selectedAlert.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedAlert(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
