'use client'

import { useState, useEffect } from 'react'
import { X, FileText, Folder, FolderOpen } from 'lucide-react'

export interface EditorTab {
  id: string
  filePath: string
  fileName: string
  content?: string
  hasUnsavedChanges?: boolean
  isActive?: boolean
}

interface EditorTabsProps {
  tabs: EditorTab[]
  activeTabId: string | null
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabsReorder?: (tabs: EditorTab[]) => void
}

export function EditorTabs({ 
  tabs, 
  activeTabId, 
  onTabSelect, 
  onTabClose,
  onTabsReorder 
}: EditorTabsProps) {
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [dragOverTab, setDragOverTab] = useState<string | null>(null)

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase()
    
    // You could expand this with more specific icons
    const iconMap: { [key: string]: string } = {
      'js': '🟨',
      'jsx': '⚛️',
      'ts': '🔷',
      'tsx': '⚛️',
      'py': '🐍',
      'rs': '🦀',
      'go': '🐹',
      'java': '☕',
      'cpp': '⚙️',
      'c': '⚙️',
      'cs': '💜',
      'php': '🐘',
      'rb': '💎',
      'swift': '🍎',
      'kt': '📱',
      'dart': '🎯',
      'json': '📋',
      'xml': '📄',
      'html': '🌐',
      'css': '🎨',
      'scss': '🎨',
      'md': '📝',
      'yml': '⚙️',
      'yaml': '⚙️',
      'sql': '🗃️',
      'sh': '⚡',
      'dockerfile': '🐳'
    }

    return iconMap[extension || ''] || '📄'
  }

  const handleTabClick = (tabId: string, event: React.MouseEvent) => {
    if (event.button === 1) { // Middle click
      event.preventDefault()
      onTabClose(tabId)
    } else {
      onTabSelect(tabId)
    }
  }

  const handleCloseClick = (tabId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    onTabClose(tabId)
  }

  const handleDragStart = (tabId: string, event: React.DragEvent) => {
    setDraggedTab(tabId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tabId)
  }

  const handleDragOver = (tabId: string, event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverTab(tabId)
  }

  const handleDragLeave = () => {
    setDragOverTab(null)
  }

  const handleDrop = (targetTabId: string, event: React.DragEvent) => {
    event.preventDefault()
    
    if (!draggedTab || draggedTab === targetTabId) {
      setDraggedTab(null)
      setDragOverTab(null)
      return
    }

    const draggedIndex = tabs.findIndex(tab => tab.id === draggedTab)
    const targetIndex = tabs.findIndex(tab => tab.id === targetTabId)

    if (draggedIndex === -1 || targetIndex === -1) return

    const newTabs = [...tabs]
    const [draggedTabData] = newTabs.splice(draggedIndex, 1)
    newTabs.splice(targetIndex, 0, draggedTabData)

    onTabsReorder?.(newTabs)
    setDraggedTab(null)
    setDragOverTab(null)
  }

  const handleDragEnd = () => {
    setDraggedTab(null)
    setDragOverTab(null)
  }

  if (tabs.length === 0) {
    return (
      <div className="h-12 border-b border-border bg-card flex items-center justify-center">
        <div className="text-sm text-muted-foreground">No files open</div>
      </div>
    )
  }

  return (
    <div className="h-12 border-b border-border bg-card">
      <div className="flex items-center h-full overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(tab.id, e)}
            onDragOver={(e) => handleDragOver(tab.id, e)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(tab.id, e)}
            onDragEnd={handleDragEnd}
            className={`
              group flex items-center min-w-0 max-w-xs border-r border-border cursor-pointer
              transition-colors duration-150 relative
              ${tab.id === activeTabId 
                ? 'bg-background text-foreground' 
                : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
              }
              ${draggedTab === tab.id ? 'opacity-50' : ''}
              ${dragOverTab === tab.id ? 'bg-accent' : ''}
            `}
            onClick={(e) => handleTabClick(tab.id, e)}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()} // Prevent middle-click scroll
          >
            {/* Active tab indicator */}
            {tab.id === activeTabId && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
            )}

            <div className="flex items-center min-w-0 px-3 py-2">
              {/* File icon */}
              <span className="text-sm mr-2 flex-shrink-0">
                {getFileIcon(tab.fileName)}
              </span>

              {/* File name */}
              <span className="text-sm truncate min-w-0 flex-1">
                {tab.fileName}
              </span>

              {/* Unsaved changes indicator */}
              {tab.hasUnsavedChanges && (
                <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full ml-2 flex-shrink-0" />
              )}

              {/* Close button */}
              <button
                onClick={(e) => handleCloseClick(tab.id, e)}
                className={`
                  ml-2 p-1 rounded-sm flex-shrink-0 transition-colors
                  opacity-0 group-hover:opacity-100
                  ${tab.id === activeTabId ? 'opacity-100' : ''}
                  hover:bg-muted text-muted-foreground hover:text-foreground
                `}
                title="Close tab (middle-click also works)"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ))}

        {/* Add some space at the end for better UX */}
        <div className="flex-1 min-w-4" />
      </div>
    </div>
  )
}