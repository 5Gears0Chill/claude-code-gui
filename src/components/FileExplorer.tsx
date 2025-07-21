'use client'

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { FileText, Loader2, AlertCircle } from 'lucide-react'
import { FileTree } from './CodeEditor/FileTree'
import { MonacoEditor } from './CodeEditor/MonacoEditor'
import { EditorTabs, EditorTab } from './CodeEditor/EditorTabs'

interface FileExplorerProps {
  selectedProject: any
}

export function FileExplorer({ selectedProject }: FileExplorerProps) {
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [isCreatingFile, setIsCreatingFile] = useState<{
    parentPath: string
    isDirectory: boolean
  } | null>(null)
  const [newFileName, setNewFileName] = useState('')

  const generateTabId = (filePath: string) => {
    return `tab-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`
  }

  const getFileName = (filePath: string) => {
    return filePath.split('/').pop() || 'Unknown'
  }

  const handleFileSelect = useCallback(async (filePath: string) => {
    // Check if file is already open
    const existingTab = openTabs.find(tab => tab.filePath === filePath)
    
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    // Create new tab
    const newTab: EditorTab = {
      id: generateTabId(filePath),
      filePath,
      fileName: getFileName(filePath),
      hasUnsavedChanges: false,
      isActive: true
    }

    setOpenTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [openTabs])

  const handleTabSelect = (tabId: string) => {
    setActiveTabId(tabId)
  }

  const handleTabClose = (tabId: string) => {
    setOpenTabs(prev => {
      const newTabs = prev.filter(tab => tab.id !== tabId)
      
      // If we're closing the active tab, activate another one
      if (tabId === activeTabId) {
        if (newTabs.length > 0) {
          // Activate the tab to the right, or the last tab if none to the right
          const closedTabIndex = prev.findIndex(tab => tab.id === tabId)
          const newActiveTab = newTabs[closedTabIndex] || newTabs[newTabs.length - 1]
          setActiveTabId(newActiveTab.id)
        } else {
          setActiveTabId(null)
        }
      }
      
      return newTabs
    })
  }

  const handleTabsReorder = (reorderedTabs: EditorTab[]) => {
    setOpenTabs(reorderedTabs)
  }

  const handleContentChange = (tabId: string, content: string) => {
    setOpenTabs(prev => 
      prev.map(tab => 
        tab.id === tabId 
          ? { ...tab, content, hasUnsavedChanges: true }
          : tab
      )
    )
  }

  const handleFileSave = (tabId: string) => {
    setOpenTabs(prev => 
      prev.map(tab => 
        tab.id === tabId 
          ? { ...tab, hasUnsavedChanges: false }
          : tab
      )
    )
  }

  const handleFileCreate = async (parentPath: string, isDirectory: boolean) => {
    setIsCreatingFile({ parentPath, isDirectory })
    setNewFileName('')
  }

  const handleFileCreateSubmit = async () => {
    if (!isCreatingFile || !newFileName.trim()) return

    try {
      const newPath = `${isCreatingFile.parentPath}/${newFileName.trim()}`
      
      if (isCreatingFile.isDirectory) {
        await invoke('create_directory', { dirPath: newPath })
      } else {
        await invoke('create_file', { filePath: newPath, content: '' })
        // Auto-open the new file
        handleFileSelect(newPath)
      }
      
      setIsCreatingFile(null)
      setNewFileName('')
    } catch (error) {
      console.error('Failed to create file/directory:', error)
      alert(`Failed to create ${isCreatingFile.isDirectory ? 'directory' : 'file'}: ${error}`)
    }
  }

  const handleFileCreateCancel = () => {
    setIsCreatingFile(null)
    setNewFileName('')
  }

  const handleFileDelete = async (filePath: string) => {
    const fileName = getFileName(filePath)
    
    if (!confirm(`Are you sure you want to delete "${fileName}"?`)) {
      return
    }

    try {
      await invoke('delete_file', { filePath })
      
      // Close tab if it's open
      const tabToClose = openTabs.find(tab => tab.filePath === filePath)
      if (tabToClose) {
        handleTabClose(tabToClose.id)
      }
    } catch (error) {
      console.error('Failed to delete file:', error)
      alert(`Failed to delete file: ${error}`)
    }
  }

  const handleFileRename = async (oldPath: string, newPath: string) => {
    const oldFileName = getFileName(oldPath)
    const newName = prompt('Enter new name:', oldFileName)
    
    if (!newName || newName === oldFileName) return

    try {
      const dirPath = oldPath.substring(0, oldPath.lastIndexOf('/'))
      const finalNewPath = `${dirPath}/${newName}`
      
      await invoke('rename_file', { oldPath, newPath: finalNewPath })
      
      // Update tab if it's open
      const tabToUpdate = openTabs.find(tab => tab.filePath === oldPath)
      if (tabToUpdate) {
        setOpenTabs(prev => 
          prev.map(tab => 
            tab.id === tabToUpdate.id 
              ? { ...tab, filePath: finalNewPath, fileName: newName }
              : tab
          )
        )
      }
    } catch (error) {
      console.error('Failed to rename file:', error)
      alert(`Failed to rename file: ${error}`)
    }
  }

  const activeTab = openTabs.find(tab => tab.id === activeTabId)

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileText size={48} className="text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No Project Selected</h3>
          <p className="text-muted-foreground">
            Select a project from the Projects tab to explore its files.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex">
      {/* File Tree Sidebar */}
      <div className="w-80 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h3 className="font-medium text-foreground">File Explorer</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedProject.name}
          </p>
        </div>
        
        <div className="flex-1 overflow-hidden">
          <FileTree
            projectPath={selectedProject.path}
            onFileSelect={handleFileSelect}
            selectedFilePath={activeTab?.filePath}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
            onFileRename={handleFileRename}
          />
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col">
        {openTabs.length > 0 ? (
          <>
            {/* Editor Tabs */}
            <EditorTabs
              tabs={openTabs}
              activeTabId={activeTabId}
              onTabSelect={handleTabSelect}
              onTabClose={handleTabClose}
              onTabsReorder={handleTabsReorder}
            />

            {/* Monaco Editor */}
            {activeTab && (
              <div className="flex-1">
                <MonacoEditor
                  key={activeTab.id} // Force remount when switching tabs
                  filePath={activeTab.filePath}
                  theme="dark"
                  onContentChange={(content) => handleContentChange(activeTab.id, content)}
                  onSave={() => handleFileSave(activeTab.id)}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={48} className="text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No File Selected</h3>
              <p className="text-muted-foreground">
                Select a file from the explorer to start editing.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* File Creation Modal */}
      {isCreatingFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-96">
            <h3 className="text-lg font-medium mb-4">
              Create New {isCreatingFile.isDirectory ? 'Folder' : 'File'}
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Name:</label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleFileCreateSubmit()
                  } else if (e.key === 'Escape') {
                    handleFileCreateCancel()
                  }
                }}
                className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder={isCreatingFile.isDirectory ? 'folder-name' : 'file-name.ext'}
                autoFocus
              />
            </div>
            
            <div className="text-xs text-muted-foreground mb-4">
              Creating in: {isCreatingFile.parentPath}
            </div>
            
            <div className="flex justify-end space-x-2">
              <button
                onClick={handleFileCreateCancel}
                className="px-4 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFileCreateSubmit}
                disabled={!newFileName.trim()}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}