import { useEffect, useState } from 'react';
import {
  Download,
  Edit3,
  Eye,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Music,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { Lang } from '../i18n';
import { translations } from '../i18n';
import type { LibraryFileDTO, LibraryFolder } from '../types';

interface Props {
  lang: Lang;
}

const FOLDERS: Array<'all' | LibraryFolder> = [
  'all',
  'images',
  'videos',
  'music',
  'audio',
  'documents',
  'uploads',
  'projects',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function FileLibrary({ lang }: Props) {
  const t = translations[lang];
  const [folder, setFolder] = useState<'all' | LibraryFolder>('all');
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<LibraryFileDTO[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [previewFile, setPreviewFile] = useState<LibraryFileDTO | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);

  useEffect(() => {
    loadFiles();
  }, [folder, search]);

  async function loadFiles() {
    const res = await api.listLibrary(folder === 'all' ? undefined : folder, search || undefined);
    setFiles(res.files);
  }

  async function handleRename(id: string) {
    if (!renameVal.trim()) {
      setRenamingId(null);
      return;
    }
    await api.renameLibraryFile(id, renameVal.trim());
    setRenamingId(null);
    loadFiles();
  }

  async function handleDelete(id: string) {
    await api.deleteLibraryFile(id);
    if (previewFile?.id === id) setPreviewFile(null);
    loadFiles();
  }

  async function openPreview(file: LibraryFileDTO) {
    setPreviewFile(file);
    setPreviewText(null);
    if (
      file.mimeType.startsWith('text/') ||
      file.mimeType.includes('json') ||
      file.mimeType.includes('xml')
    ) {
      const res = await fetch(file.url);
      setPreviewText((await res.text()).slice(0, 30000));
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t.library.title}</h1>
          <label className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-indigo-500 cursor-pointer">
            <span>{t.common.upload}</span>
            <input
              type="file"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                await api.uploadFile(f, folder === 'all' ? 'uploads' : folder);
                loadFiles();
              }}
            />
          </label>
        </div>

        {/* Folder Tabs & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1">
            {FOLDERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFolder(f)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  folder === f
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>{t.library.folders[f]}</span>
              </button>
            ))}
          </div>
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.common.search}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] ps-9 pe-3 py-2 text-xs outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {files.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center text-sm text-slate-500">
            {t.common.noData}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {files.map((f) => {
              const isImg = f.mimeType.startsWith('image/');
              const isVid = f.mimeType.startsWith('video/');
              const isAud = f.mimeType.startsWith('audio/');
              return (
                <div
                  key={f.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] overflow-hidden flex flex-col justify-between"
                >
                  <div
                    onClick={() => openPreview(f)}
                    className="h-40 bg-slate-100 dark:bg-slate-950 flex items-center justify-center cursor-pointer overflow-hidden"
                  >
                    {isImg ? (
                      <img
                        src={f.url}
                        alt={f.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : isVid ? (
                      <Film className="w-10 h-10 text-indigo-500" />
                    ) : isAud ? (
                      <Music className="w-10 h-10 text-indigo-500" />
                    ) : (
                      <FileText className="w-10 h-10 text-slate-400" />
                    )}
                  </div>

                  <div className="p-3.5 space-y-2">
                    {renamingId === f.id ? (
                      <input
                        autoFocus
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onBlur={() => handleRename(f.id)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRename(f.id)}
                        className="w-full rounded-lg border border-indigo-500 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs"
                      />
                    ) : (
                      <p className="font-medium text-sm truncate" title={f.name}>
                        {f.name}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
                      <span>
                        {f.folder} · {formatBytes(f.sizeBytes)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openPreview(f)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                          title={t.library.preview}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(f.id);
                            setRenameVal(f.name);
                          }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                          title={t.common.rename}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <a
                          href={`${f.url}?download=1`}
                          download={f.name}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                          title={t.common.download}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDelete(f.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-500"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline Preview Modal */}
        {previewFile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                <span className="font-medium text-sm truncate">{previewFile.name}</span>
                <button type="button" onClick={() => setPreviewFile(null)}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 max-h-[75vh] overflow-auto flex items-center justify-center">
                {previewFile.mimeType.startsWith('image/') ? (
                  <img
                    src={previewFile.url}
                    alt={previewFile.name}
                    referrerPolicy="no-referrer"
                    className="max-h-[65vh] rounded-xl"
                  />
                ) : previewFile.mimeType.startsWith('video/') ? (
                  <video controls src={previewFile.url} className="max-h-[65vh] w-full rounded-xl" />
                ) : previewFile.mimeType.startsWith('audio/') ? (
                  <audio controls src={previewFile.url} className="w-full" />
                ) : previewText !== null ? (
                  <pre
                    dir="ltr"
                    className="w-full rounded-xl bg-slate-950 text-slate-100 p-4 text-xs font-mono overflow-auto max-h-[60vh]"
                  >
                    {previewText}
                  </pre>
                ) : (
                  <div className="text-center space-y-3 py-8">
                    <ImageIcon className="w-10 h-10 text-slate-400 mx-auto" />
                    <p className="text-sm text-slate-500">{previewFile.mimeType}</p>
                    <a
                      href={`${previewFile.url}?download=1`}
                      download={previewFile.name}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white"
                    >
                      <Download className="w-4 h-4" />
                      <span>{t.common.download}</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
