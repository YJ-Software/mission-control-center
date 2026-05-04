'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { RotateCcw, Trash2, Archive, AlertTriangle, X } from 'lucide-react'

interface BackupFile {
  filename: string
  size: number
  sizeHuman: string
  createdAt: string
  filePath: string
}

interface BackupFilesData {
  files: BackupFile[]
}

interface DashboardData {
  backupToken: string
}

type ModalState =
  | { phase: 'dry-run-loading'; file: BackupFile }
  | { phase: 'dry-run-result'; file: BackupFile; output: string }
  | { phase: 'restoring'; file: BackupFile; output: string }
  | { phase: 'restore-done'; file: BackupFile; output: string }

export function BackupRestore() {
  const t = useTranslations('backup')
  const queryClient = useQueryClient()

  const [modal, setModal] = useState<ModalState | null>(null)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)
  const [deletingInProgress, setDeletingInProgress] = useState<string | null>(null)

  const { data: filesData, isLoading: filesLoading } = useQuery<BackupFilesData>({
    queryKey: ['backup-files'],
    queryFn: async () => {
      const res = await fetch('/api/backup?type=backups')
      if (!res.ok) throw new Error('Failed to fetch backup files')
      return res.json()
    },
    refetchInterval: 10000,
  })

  const { data: dashboardData } = useQuery<DashboardData>({
    queryKey: ['backup-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/backup?type=dashboard')
      if (!res.ok) throw new Error('Failed to fetch dashboard')
      return res.json()
    },
  })

  const backupToken = dashboardData?.backupToken ?? ''

  async function handleRestore(file: BackupFile) {
    setModal({ phase: 'dry-run-loading', file })
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backup-Token': backupToken,
        },
        body: JSON.stringify({ file: file.filePath, dryRun: true }),
      })
      const data = await res.json()
      setModal({ phase: 'dry-run-result', file, output: data.output ?? '' })
    } catch (err) {
      setModal(null)
    }
  }

  async function handleConfirmRestore(file: BackupFile, dryRunOutput: string) {
    setModal({ phase: 'restoring', file, output: dryRunOutput })
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backup-Token': backupToken,
        },
        body: JSON.stringify({ file: file.filePath, dryRun: false }),
      })
      const data = await res.json()
      setModal({ phase: 'restore-done', file, output: data.output ?? '' })
    } catch (err) {
      setModal({ phase: 'restore-done', file, output: String(err) })
    }
  }

  async function handleDelete(filePath: string) {
    setDeletingInProgress(filePath)
    try {
      await fetch('/api/backup?action=delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Backup-Token': backupToken,
        },
        body: JSON.stringify({ file: filePath }),
      })
      queryClient.invalidateQueries({ queryKey: ['backup-files'] })
    } finally {
      setDeletingInProgress(null)
      setDeletingFile(null)
    }
  }

  if (filesLoading) {
    return <div className="text-white/50 text-sm font-mono p-4">載入中...</div>
  }

  const files = filesData?.files ?? []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="cyber-card p-4">
        <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
          {t('restore.title')}
        </h2>
      </div>

      {/* Empty state */}
      {files.length === 0 && (
        <div className="cyber-card p-12 flex flex-col items-center justify-center gap-3 text-center">
          <Archive className="w-10 h-10 text-white/20" />
          <p className="text-sm text-white/40">{t('restore.noBackups')}</p>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="cyber-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-4 py-3 text-[11px] text-white/40 uppercase tracking-wider font-medium">
                  {t('restore.name')}
                </th>
                <th className="text-left px-4 py-3 text-[11px] text-white/40 uppercase tracking-wider font-medium">
                  {t('restore.created')}
                </th>
                <th className="text-left px-4 py-3 text-[11px] text-white/40 uppercase tracking-wider font-medium">
                  {t('restore.size')}
                </th>
                <th className="text-right px-4 py-3 text-[11px] text-white/40 uppercase tracking-wider font-medium">
                  {t('restore.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const isConfirmingDelete = deletingFile === file.filePath
                const isDeleting = deletingInProgress === file.filePath

                return (
                  <tr
                    key={file.filePath}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Name */}
                    <td className="px-4 py-3 font-mono text-xs text-white/80 break-all">
                      {file.filename}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">
                      {new Date(file.createdAt).toLocaleString('zh-TW', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Size */}
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">
                      {file.sizeHuman}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-yellow-400">{t('restore.deleteConfirm')}</span>
                            <button
                              onClick={() => handleDelete(file.filePath)}
                              disabled={isDeleting}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                            >
                              {isDeleting ? '...' : t('common.delete')}
                            </button>
                            <button
                              onClick={() => setDeletingFile(null)}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-white/10 text-white/50 hover:bg-white/20 transition-colors"
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => handleRestore(file)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              {t('restore.restoreBtn')}
                            </button>
                            <button
                              onClick={() => setDeletingFile(file.filePath)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {t('restore.deleteBtn')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Restore modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-white/[0.1] rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                {t('restore.previewTitle')}
              </h3>
              {(modal.phase === 'dry-run-result' || modal.phase === 'restore-done') && (
                <button
                  onClick={() => setModal(null)}
                  className="text-white/40 hover:text-white/70 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filename */}
            <p className="text-xs text-white/50 font-mono mb-4 truncate">
              {modal.file.filename}
            </p>

            {/* Loading state */}
            {modal.phase === 'dry-run-loading' && (
              <div className="flex items-center gap-3 text-white/50 text-sm py-8 justify-center">
                <RotateCcw className="w-4 h-4 animate-spin" />
                <span>{t('restore.dryRun')}...</span>
              </div>
            )}

            {/* Restoring state */}
            {modal.phase === 'restoring' && (
              <div className="flex items-center gap-3 text-cyan-400 text-sm py-8 justify-center">
                <RotateCcw className="w-4 h-4 animate-spin" />
                <span>{t('restore.restoreBtn')}...</span>
              </div>
            )}

            {/* Dry-run result */}
            {modal.phase === 'dry-run-result' && (
              <>
                {/* Warning banner */}
                <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs mb-4">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t('restore.restoreWarning')}</span>
                </div>

                {/* Dry-run output */}
                <pre className="font-mono text-xs text-white/70 bg-black/40 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap mb-6">
                  {modal.output || '(no output)'}
                </pre>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setModal(null)}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/60 hover:bg-white/20 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => handleConfirmRestore(modal.file, modal.output)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t('restore.confirmRestore')}
                  </button>
                </div>
              </>
            )}

            {/* Restore done */}
            {modal.phase === 'restore-done' && (
              <>
                <pre className="font-mono text-xs text-white/70 bg-black/40 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap mb-6">
                  {modal.output || '(no output)'}
                </pre>
                <div className="flex justify-end">
                  <button
                    onClick={() => setModal(null)}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-white/10 text-white/60 hover:bg-white/20 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
