import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Code2,
  Cpu,
  Film,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Menu,
  MessageSquare,
  Moon,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Wrench,
  X,
} from 'lucide-react';
import { api } from './api';
import { AudioStudio } from './components/AudioStudio';
import { ChatWorkspace } from './components/ChatWorkspace';
import { CodeStudio } from './components/CodeStudio';
import { FileLibrary } from './components/FileLibrary';
import { ImageStudio } from './components/ImageStudio';
import { ModelsManager } from './components/ModelsManager';
import { SettingsGateway } from './components/SettingsGateway';
import { ToolsHub } from './components/ToolsHub';
import { UsageDashboard } from './components/UsageDashboard';
import { VideoStudio } from './components/VideoStudio';
import { translations } from './i18n';
import type { ActiveView, ModelDTO, ProviderDTO, StudioSettings } from './types';

const DEFAULT_SETTINGS_CLIENT: StudioSettings = {
  language: 'fa',
  theme: 'dark',
  defaultSystemPrompt:
    'You are a precise, helpful AI assistant inside MAHRAD AI STUDIO. Respond clearly in the user’s language.',
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
  memoryEnabled: true,
  searchEndpointUrl: '',
  searchProviderType: 'none',
};

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS_CLIENT);
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [models, setModels] = useState<ModelDTO[]>([]);

  const lang = settings.language;
  const t = translations[lang];

  const refreshData = useCallback(async () => {
    try {
      const [provRes, modRes] = await Promise.all([api.listProviders(), api.listModels()]);
      setProviders(provRes.providers);
      setModels(modRes.models);
    } catch {
      // ignore initial load error
    }
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((res) => setSettings(res.settings))
      .catch(() => {});
    refreshData();
  }, [refreshData]);

  // Keep HTML lang, dir, and dark class synchronized
  useEffect(() => {
    const html = document.documentElement;
    html.lang = settings.language;
    html.dir = settings.language === 'fa' ? 'rtl' : 'ltr';
    if (settings.theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [settings.language, settings.theme]);

  async function handleUpdateSettings(partial: Partial<StudioSettings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    try {
      const res = await api.saveSettings(partial);
      setSettings(res.settings);
    } catch {
      // ignore
    }
  }

  const navItems: Array<{ id: ActiveView; label: string; icon: typeof MessageSquare }> = [
    { id: 'chat', label: t.nav.chat, icon: MessageSquare },
    { id: 'image', label: t.nav.image, icon: ImageIcon },
    { id: 'video', label: t.nav.video, icon: Film },
    { id: 'audio', label: t.nav.audio, icon: Music },
    { id: 'code', label: t.nav.code, icon: Code2 },
    { id: 'tools', label: t.nav.tools, icon: Wrench },
    { id: 'models', label: t.nav.models, icon: Cpu },
    { id: 'usage', label: t.nav.usage, icon: BarChart3 },
    { id: 'library', label: t.nav.library, icon: FolderOpen },
    { id: 'settings', label: t.nav.settings, icon: Settings },
  ];

  const activeNav = navItems.find((n) => n.id === activeView);

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#080C14] dark:text-slate-100">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 border-e border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B101B] transition-all duration-200 ${
          sidebarCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 dark:border-slate-800/80 px-3.5">
          {!sidebarCollapsed && (
            <span className="font-bold text-sm tracking-tight whitespace-nowrap truncate">
              {t.brand}
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white mx-auto"
            aria-label="Toggle Sidebar"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors min-h-[42px] ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-100'
                } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800/80 p-3 text-xs text-slate-500">
          {!sidebarCollapsed && (
            <div className="flex items-center justify-between font-mono tabular-nums">
              <span>{providers.length} API</span>
              <span>·</span>
              <span>{models.filter((m) => m.isEnabled).length} Models</span>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Slide-Over Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 flex h-full w-72 flex-col bg-white dark:bg-[#0B101B] border-e border-slate-200 dark:border-slate-800">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4">
              <span className="font-bold text-sm tracking-tight">{t.brand}</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-xl p-2 text-slate-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveView(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium min-h-[44px] ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-[#0B101B]/80 backdrop-blur-md px-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden rounded-xl border border-slate-200 dark:border-slate-800 p-2 min-h-[40px] min-w-[40px] flex items-center justify-center"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-semibold text-sm truncate whitespace-nowrap">
              {activeNav?.label}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({ language: settings.language === 'fa' ? 'en' : 'fa' })
              }
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[38px]"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{settings.language === 'fa' ? 'EN' : 'FA'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                handleUpdateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
              }
              className="rounded-xl border border-slate-200 dark:border-slate-800 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[38px] min-w-[38px] flex items-center justify-center"
              aria-label="Toggle Theme"
            >
              {settings.theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveView('settings')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 min-h-[38px] whitespace-nowrap"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.nav.settings}</span>
            </button>
          </div>
        </header>

        {/* Active Studio Viewport */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {activeView === 'chat' && (
            <ChatWorkspace
              lang={lang}
              models={models}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onNavigate={setActiveView}
            />
          )}
          {activeView === 'image' && (
            <ImageStudio lang={lang} models={models} onNavigate={setActiveView} />
          )}
          {activeView === 'video' && (
            <VideoStudio lang={lang} models={models} onNavigate={setActiveView} />
          )}
          {activeView === 'audio' && (
            <AudioStudio lang={lang} models={models} onNavigate={setActiveView} />
          )}
          {activeView === 'code' && (
            <CodeStudio lang={lang} models={models} onNavigate={setActiveView} />
          )}
          {activeView === 'tools' && <ToolsHub lang={lang} models={models} />}
          {activeView === 'models' && (
            <ModelsManager
              lang={lang}
              models={models}
              providers={providers}
              onRefreshData={refreshData}
            />
          )}
          {activeView === 'usage' && (
            <UsageDashboard lang={lang} providers={providers} onRefreshData={refreshData} />
          )}
          {activeView === 'library' && <FileLibrary lang={lang} />}
          {activeView === 'settings' && (
            <SettingsGateway
              lang={lang}
              providers={providers}
              settings={settings}
              onRefreshData={refreshData}
              onUpdateSettings={handleUpdateSettings}
            />
          )}
        </main>
      </div>
    </div>
  );
}
