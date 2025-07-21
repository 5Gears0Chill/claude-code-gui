'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Settings, Code, Check, ExternalLink, Folder } from 'lucide-react'

interface IDE {
  name: string
  command: string
  args: string[]
  available: boolean
}

interface IDESettingsProps {
  selectedProject?: any
}

export function IDESettings({ selectedProject }: IDESettingsProps) {
  const [ides, setIdes] = useState<IDE[]>([])
  const [selectedIDE, setSelectedIDE] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadAvailableIDEs()
    loadSelectedIDE()
  }, [])

  const loadAvailableIDEs = async () => {
    try {
      setLoading(true)
      const detectedIDEs = await invoke<IDE[]>('detect_available_ides')
      setIdes(detectedIDEs)
    } catch (error) {
      console.error('Failed to detect IDEs:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadSelectedIDE = () => {
    const stored = localStorage.getItem('selectedIDE')
    if (stored) {
      setSelectedIDE(stored)
    }
  }

  const handleIDESelect = (ideCommand: string) => {
    setSelectedIDE(ideCommand)
    localStorage.setItem('selectedIDE', ideCommand)
  }

  const openProjectInIDE = async () => {
    if (!selectedProject || !selectedIDE) return

    try {
      await invoke('open_project_in_ide', {
        ideCommand: selectedIDE,
        projectPath: selectedProject.path
      })
    } catch (error) {
      console.error('Failed to open project in IDE:', error)
    }
  }

  const availableIDEs = ides.filter(ide => ide.available)

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <Settings size={24} className="text-primary" />
          <div>
            <h2 className="text-2xl font-semibold text-foreground">IDE Integration</h2>
            <p className="text-muted-foreground mt-1">
              Configure your preferred IDE for opening files and projects
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-foreground mb-4">Available IDEs</h3>
              {availableIDEs.length === 0 ? (
                <div className="text-center py-8">
                  <Code size={48} className="text-muted-foreground mx-auto mb-4" />
                  <h4 className="text-lg font-medium text-foreground mb-2">No IDEs Detected</h4>
                  <p className="text-muted-foreground">
                    No supported IDEs were found on your system. Install VS Code, Sublime Text, or another supported IDE.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {availableIDEs.map((ide) => (
                    <div
                      key={ide.command}
                      onClick={() => handleIDESelect(ide.command)}
                      className={`p-4 border rounded-lg cursor-pointer transition-all hover:bg-accent/50 ${
                        selectedIDE === ide.command
                          ? 'border-primary bg-primary/5'
                          : 'border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Code size={20} className="text-primary" />
                          <div>
                            <h4 className="font-medium text-foreground">{ide.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              Command: <code className="bg-muted px-1 py-0.5 rounded text-xs">{ide.command}</code>
                            </p>
                          </div>
                        </div>
                        {selectedIDE === ide.command && (
                          <Check size={20} className="text-primary" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedProject && selectedIDE && (
              <div className="border-t border-border pt-6">
                <h3 className="text-lg font-medium text-foreground mb-4">Quick Actions</h3>
                <div className="flex space-x-4">
                  <button
                    onClick={openProjectInIDE}
                    className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
                  >
                    <Folder size={16} />
                    <span>Open Project in {ides.find(ide => ide.command === selectedIDE)?.name}</span>
                    <ExternalLink size={14} />
                  </button>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Project: {selectedProject.name}
                </p>
              </div>
            )}

            <div className="border-t border-border pt-6">
              <h3 className="text-lg font-medium text-foreground mb-4">How it works</h3>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>• File links in chat messages will open directly in your selected IDE</p>
                <p>• Line numbers are supported for VS Code, Sublime Text, and other compatible editors</p>
                <p>• Use the "Open Project" button to launch your entire project workspace</p>
                <p>• IDE preference is saved locally and persists between sessions</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}