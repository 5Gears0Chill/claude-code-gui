'use client'

import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { 
  File, 
  Folder, 
  FolderOpen, 
  Search, 
  Plus, 
  FolderPlus,
  MoreHorizontal,
  RefreshCw
} from 'lucide-react'
import Fuse from 'fuse.js'

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modified?: string
  extension?: string
  children?: FileTreeNode[]
  isExpanded?: boolean
}

interface FileTreeProps {
  projectPath: string
  onFileSelect: (filePath: string) => void
  selectedFilePath?: string
  onFileCreate?: (parentPath: string, isDirectory: boolean) => void
  onFileDelete?: (filePath: string) => void
  onFileRename?: (oldPath: string, newPath: string) => void
}

export function FileTree({ 
  projectPath, 
  onFileSelect, 
  selectedFilePath,
  onFileCreate,
  onFileDelete,
  onFileRename 
}: FileTreeProps) {
  const [treeData, setTreeData] = useState<FileTreeNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: FileTreeNode
  } | null>(null)

  // Fuzzy search setup
  const fuse = useMemo(() => {
    if (!treeData) return null
    
    const flattenTree = (node: FileTreeNode): FileTreeNode[] => {
      const result = [node]
      if (node.children) {
        node.children.forEach(child => {
          result.push(...flattenTree(child))
        })
      }
      return result
    }

    const allNodes = flattenTree(treeData).filter(node => node.type === 'file')
    
    return new Fuse(allNodes, {
      keys: ['name', 'path'],
      threshold: 0.4,
      includeScore: true
    })
  }, [treeData])

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !fuse) return []
    return fuse.search(searchQuery).map(result => result.item)
  }, [searchQuery, fuse])

  useEffect(() => {
    if (projectPath) {
      loadDirectoryTree()
    }
  }, [projectPath])

  const loadDirectoryTree = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await invoke<any>('get_directory_tree', { dirPath: projectPath })
      setTreeData(data)
      
      // Auto-expand the root directory
      setExpandedPaths(new Set([data.path]))
    } catch (err) {
      setError(err as string)
      console.error('Failed to load directory tree:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleDirectory = (path: string) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev)
      if (newSet.has(path)) {
        newSet.delete(path)
      } else {
        newSet.add(path)
      }
      return newSet
    })
  }

  const handleFileClick = (node: FileTreeNode) => {
    if (node.type === 'directory') {
      toggleDirectory(node.path)
    } else {
      onFileSelect(node.path)
    }
  }

  const handleContextMenu = (event: React.MouseEvent, node: FileTreeNode) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node
    })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  const handleCreateFile = (parentPath: string, isDirectory: boolean) => {
    onFileCreate?.(parentPath, isDirectory)
    closeContextMenu()
    // Refresh tree after creation
    setTimeout(loadDirectoryTree, 100)
  }

  const getFileIcon = (node: FileTreeNode) => {
    if (node.type === 'directory') {
      return expandedPaths.has(node.path) ? (
        <FolderOpen size={16} className="text-blue-500" />
      ) : (
        <Folder size={16} className="text-blue-500" />
      )
    }

    // File type specific icons
    const extension = node.extension?.toLowerCase() || node.name.split('.').pop()?.toLowerCase()
    const iconMap: { [key: string]: string } = {
      'js': '🟨', 'jsx': '⚛️', 'ts': '🔷', 'tsx': '⚛️',
      'py': '🐍', 'rs': '🦀', 'go': '🐹', 'java': '☕',
      'cpp': '⚙️', 'c': '⚙️', 'cs': '💜', 'php': '🐘',
      'rb': '💎', 'swift': '🍎', 'kt': '📱', 'dart': '🎯',
      'json': '📋', 'xml': '📄', 'html': '🌐', 'css': '🎨',
      'scss': '🎨', 'md': '📝', 'yml': '⚙️', 'yaml': '⚙️',
      'sql': '🗃️', 'sh': '⚡', 'dockerfile': '🐳'
    }

    const emoji = iconMap[extension || '']
    if (emoji) {
      return <span className="text-sm">{emoji}</span>
    }

    return <File size={16} className="text-muted-foreground" />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const renderTreeNode = (node: FileTreeNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.path)
    const isSelected = selectedFilePath === node.path
    const hasChildren = node.children && node.children.length > 0

    return (
      <div key={node.path}>
        <div
          className={`
            flex items-center px-2 py-1 cursor-pointer hover:bg-accent rounded-sm
            transition-colors group
            ${isSelected ? 'bg-accent text-accent-foreground' : ''}
          `}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleFileClick(node)}
          onContextMenu={(e) => handleContextMenu(e, node)}
        >
          <div className="flex items-center flex-1 min-w-0">
            {getFileIcon(node)}
            <span className="ml-2 text-sm truncate">{node.name}</span>
            {node.type === 'file' && node.size && (
              <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {formatFileSize(node.size)}
              </span>
            )}
          </div>
        </div>

        {node.type === 'directory' && isExpanded && hasChildren && (
          <div>
            {node.children!
              .sort((a, b) => {
                // Directories first, then files, both alphabetically
                if (a.type !== b.type) {
                  return a.type === 'directory' ? -1 : 1
                }
                return a.name.localeCompare(b.name)
              })
              .map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderSearchResults = () => {
    if (!searchQuery.trim()) return null

    return (
      <div className="mt-4">
        <div className="text-xs font-medium text-muted-foreground mb-2 px-2">
          Search Results ({searchResults.length})
        </div>
        <div className="space-y-1">
          {searchResults.map(node => (
            <div
              key={node.path}
              className={`
                flex items-center px-2 py-1 cursor-pointer hover:bg-accent rounded-sm
                transition-colors
                ${selectedFilePath === node.path ? 'bg-accent text-accent-foreground' : ''}
              `}
              onClick={() => onFileSelect(node.path)}
            >
              {getFileIcon(node)}
              <div className="ml-2 flex-1 min-w-0">
                <div className="text-sm truncate">{node.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {node.path.replace(projectPath, '').substring(1)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <div className="text-red-500 text-sm mb-2">Failed to load directory</div>
        <div className="text-xs text-muted-foreground mb-3">{error}</div>
        <button
          onClick={loadDirectoryTree}
          className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search Bar */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-sm font-medium text-foreground">Files</div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => onFileCreate?.(projectPath, false)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            title="New file"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => onFileCreate?.(projectPath, true)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            title="New folder"
          >
            <FolderPlus size={16} />
          </button>
          <button
            onClick={loadDirectoryTree}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto p-2">
        {searchQuery.trim() ? (
          renderSearchResults()
        ) : (
          treeData && renderTreeNode(treeData)
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={closeContextMenu}
          />
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-40"
            style={{ 
              left: contextMenu.x, 
              top: contextMenu.y 
            }}
          >
            <button
              onClick={() => handleCreateFile(
                contextMenu.node.type === 'directory' 
                  ? contextMenu.node.path 
                  : contextMenu.node.path.substring(0, contextMenu.node.path.lastIndexOf('/')),
                false
              )}
              className="w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
            >
              <Plus size={16} className="inline mr-2" />
              New File
            </button>
            <button
              onClick={() => handleCreateFile(
                contextMenu.node.type === 'directory' 
                  ? contextMenu.node.path 
                  : contextMenu.node.path.substring(0, contextMenu.node.path.lastIndexOf('/')),
                true
              )}
              className="w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
            >
              <FolderPlus size={16} className="inline mr-2" />
              New Folder
            </button>
            <hr className="border-border my-1" />
            <button
              onClick={() => {
                onFileRename?.(contextMenu.node.path, contextMenu.node.path)
                closeContextMenu()
              }}
              className="w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
            >
              Rename
            </button>
            <button
              onClick={() => {
                onFileDelete?.(contextMenu.node.path)
                closeContextMenu()
                setTimeout(loadDirectoryTree, 100)
              }}
              className="w-full px-3 py-2 text-sm text-left hover:bg-destructive hover:text-destructive-foreground transition-colors"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}