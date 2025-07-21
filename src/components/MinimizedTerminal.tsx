'use client'

import { useState, useEffect, useRef } from 'react'
import { Terminal as TerminalIcon, Maximize2, X, Minus, MessageSquare } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getCurrentWindow } from '@tauri-apps/api/window'
import '@xterm/xterm/css/xterm.css'

interface MinimizedTerminalProps {
  selectedProject: any
  selectedSessionId?: string
  onRestore: () => void
  onClose: () => void
}

export function MinimizedTerminal({ selectedProject, selectedSessionId, onRestore, onClose }: MinimizedTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstanceRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  // Set initial position to bottom-right
  useEffect(() => {
    const updatePosition = () => {
      const terminalWidth = isExpanded ? 500 : 350
      const terminalHeight = isExpanded ? 400 : 60
      setPosition({
        x: window.innerWidth - terminalWidth - 20,
        y: window.innerHeight - terminalHeight - 20
      })
    }
    
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [isExpanded])

  useEffect(() => {
    if (isExpanded && terminalRef.current && !terminalInstanceRef.current) {
      initializeMiniTerminal()
    }

    // Listen for terminal output
    const setupListener = async () => {
      const window = getCurrentWindow()
      const unlisten = await window.listen<{sessionId: string, data: string}>('terminal_output', (event) => {
        if (event.payload.sessionId === selectedSessionId && terminalInstanceRef.current) {
          terminalInstanceRef.current.write(event.payload.data)
        }
      })
      return unlisten
    }

    let unlisten: (() => void) | null = null
    if (isExpanded) {
      setupListener().then((fn) => { unlisten = fn })
    }

    return () => {
      if (unlisten) unlisten()
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose()
        terminalInstanceRef.current = null
      }
    }
  }, [isExpanded, selectedSessionId])

  const initializeMiniTerminal = () => {
    if (!terminalRef.current) return

    const terminal = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
      },
      fontFamily: '"JetBrains Mono", "SF Mono", "Monaco", monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 1000,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminalInstanceRef.current = terminal
    fitAddonRef.current = fitAddon

    terminal.open(terminalRef.current)
    
    setTimeout(() => {
      fitAddon.fit()
    }, 50)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, dragOffset])

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 1000,
    width: isExpanded ? '500px' : '350px',
    height: isExpanded ? '400px' : '60px',
    transition: isDragging ? 'none' : 'all 0.3s ease',
    cursor: isDragging ? 'grabbing' : 'default'
  }

  return (
    <div
      style={containerStyle}
      className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center space-x-2">
          <TerminalIcon size={16} className="text-blue-400" />
          <span className="text-sm font-medium text-gray-200">
            {selectedProject?.name || 'Terminal'}
          </span>
          {selectedSessionId && (
            <span className="text-xs text-gray-400">
              ({selectedSessionId.slice(0, 8)})
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <Minus size={14} /> : <MessageSquare size={14} />}
          </button>
          <button
            onClick={onRestore}
            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title="Restore terminal"
          >
            <Maximize2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
            title="Close terminal"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      {isExpanded && (
        <div className="h-full pb-12">
          <div
            ref={terminalRef}
            className="w-full h-full p-2"
          />
        </div>
      )}

      {/* Collapsed State */}
      {!isExpanded && (
        <div className="px-4 py-3 flex items-center justify-between bg-gray-900">
          <div className="flex items-center space-x-3">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <div>
              <div className="text-sm font-medium text-gray-200">Terminal Active</div>
              <div className="text-xs text-gray-400">
                Session: {selectedSessionId?.slice(0, 8) || 'Unknown'}
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-400">
            Click to expand
          </div>
        </div>
      )}
    </div>
  )
}