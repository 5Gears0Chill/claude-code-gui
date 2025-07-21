'use client'

import { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Plus, Search, Settings, Maximize, Minimize, Terminal as TerminalIcon, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

interface TerminalInterfaceProps {
  selectedProject: any
  selectedSessionId?: string
  onTerminalStateChange?: (isActive: boolean) => void
}

interface TerminalSession {
  id: string
  name: string
  active: boolean
  projectPath: string
}

export function TerminalInterface({ selectedProject, selectedSessionId, onTerminalStateChange }: TerminalInterfaceProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstanceRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isTerminalReady, setIsTerminalReady] = useState(false)
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const [isSearchVisible, setIsSearchVisible] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const [terminalHistory, setTerminalHistory] = useState<string>('')
  const isInitializingRef = useRef<boolean>(false)
  const [isVisible, setIsVisible] = useState(true)

  // Initialize terminal when component mounts or project changes
  useEffect(() => {
    console.log('[TerminalInterface] useEffect triggered - selectedProject:', selectedProject?.name, 'terminalRef.current:', !!terminalRef.current, 'isTerminalReady:', isTerminalReady, 'isInitializing:', isInitializingRef.current)
    
    // Prevent double initialization
    if (isInitializingRef.current) {
      console.log('[TerminalInterface] Already initializing, skipping')
      return
    }
    
    if (selectedProject && terminalRef.current && !isTerminalReady) {
      isInitializingRef.current = true
      // Small delay to ensure DOM is ready
      const timeoutId = setTimeout(() => {
        console.log('[TerminalInterface] Calling initializeTerminal')
        initializeTerminal().finally(() => {
          isInitializingRef.current = false
        })
      }, 100)
      
      return () => {
        console.log('[TerminalInterface] Cleanup due to useEffect dependency change')
        clearTimeout(timeoutId)
        isInitializingRef.current = false
      }
    }
  }, [selectedProject, isTerminalReady])

  // Watch for visibility changes to refit terminal when it becomes visible
  useEffect(() => {
    if (!terminalRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        const isNowVisible = entry.isIntersecting
        console.log('[TerminalInterface] Visibility changed:', isNowVisible)
        setIsVisible(isNowVisible)
        
        // Refit terminal when it becomes visible
        if (isNowVisible && fitAddonRef.current && terminalInstanceRef.current) {
          setTimeout(() => {
            console.log('[TerminalInterface] Refitting terminal after becoming visible')
            fitAddonRef.current?.fit()
          }, 100)
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(terminalRef.current)
    
    return () => {
      observer.disconnect()
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[TerminalInterface] Component unmounting, cleaning up')
      // Preserve history on unmount if we have an active session (for minimization)
      cleanup(!!activeSessionId)
    }
  }, [])

  // Keep ref in sync with state
  useEffect(() => {
    console.log('[TerminalInterface] activeSessionId state changed to:', activeSessionId)
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  // Handle session changes
  useEffect(() => {
    if (selectedSessionId && isTerminalReady) {
      resumeSession(selectedSessionId)
    }
  }, [selectedSessionId, isTerminalReady])

  const initializeTerminal = async () => {
    console.log('[TerminalInterface] initializeTerminal called - selectedProject:', selectedProject?.name, 'selectedSessionId:', selectedSessionId)
    if (!terminalRef.current || !selectedProject) return

    // If terminal already exists and is working, don't reinitialize
    if (terminalInstanceRef.current && isTerminalReady && activeSessionId === selectedSessionId) {
      console.log('[TerminalInterface] Terminal already initialized for this session, skipping')
      return
    }

    // Clean up existing terminal but preserve history if we have an active session
    const shouldPreserveHistory = !!activeSessionId && activeSessionId === selectedSessionId
    cleanup(shouldPreserveHistory)

    try {
      // Create new terminal instance
      const terminal = new Terminal({
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          cursorAccent: '#0d1117',
          selectionBackground: '#264f78',
          black: '#484f58',
          red: '#ff7b72',
          green: '#7ee787',
          yellow: '#f2cc60',
          blue: '#79c0ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#39c5cf',
          brightWhite: '#f0f6fc',
        },
        fontFamily: '"JetBrains Mono", "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Source Code Pro", monospace',
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        tabStopWidth: 4,
        allowProposedApi: true,
        convertEol: true,
        disableStdin: false,
        macOptionIsMeta: true,
        rightClickSelectsWord: false,
        fastScrollModifier: 'shift',
        wordSeparator: ' ()[]{},."\'',
      })

      // Add addons
      const fitAddon = new FitAddon()
      const webLinksAddon = new WebLinksAddon()
      const searchAddon = new SearchAddon()

      terminal.loadAddon(fitAddon)
      terminal.loadAddon(webLinksAddon)
      terminal.loadAddon(searchAddon)

      // Store references
      terminalInstanceRef.current = terminal
      fitAddonRef.current = fitAddon
      searchAddonRef.current = searchAddon

      // Open terminal in DOM
      terminal.open(terminalRef.current)
      
      // Add CSS to prevent text decoration issues
      const terminalElement = terminalRef.current.querySelector('.xterm') as HTMLElement
      if (terminalElement) {
        terminalElement.style.textDecoration = 'none'
        terminalElement.style.textDecorationLine = 'none'
      }

      // Restore terminal history if available
      if (terminalHistory && shouldPreserveHistory) {
        console.log('[TerminalInterface] Restoring terminal history:', terminalHistory.length, 'characters')
        terminal.write(terminalHistory)
      }

      // Fit terminal to container
      setTimeout(() => {
        fitAddon.fit()
      }, 50)

      // Set up resize handler
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddon && terminal && isVisible) {
          setTimeout(() => {
            fitAddon.fit()
          }, 10)
        }
      })
      resizeObserver.observe(terminalRef.current)

      // Handle data input from terminal
      terminal.onData(async (data) => {
        const currentSessionId = activeSessionIdRef.current
        console.log('Terminal input:', data, 'Active session:', currentSessionId) // Debug logging
        if (currentSessionId) {
          try {
            await invoke('write_to_terminal', {
              sessionId: currentSessionId,
              data: data
            })
          } catch (error) {
            console.error('Failed to write to terminal:', error)
          }
        } else {
          console.warn('No active session to write to, activeSessionId:', currentSessionId)
        }
      })

      // Listen for terminal output from backend
      const window = getCurrentWindow()
      const unlisten = await window.listen<{sessionId: string, data: string}>('terminal_output', (event) => {
        console.log('[DEBUG] Received terminal_output event:', event.payload)
        console.log('[DEBUG] Current activeSessionId:', activeSessionId)
        console.log('[DEBUG] activeSessionIdRef.current:', activeSessionIdRef.current)
        console.log('[DEBUG] terminal exists:', !!terminal)
        
        // Use the ref instead of state to avoid stale closure
        if (event.payload.sessionId === activeSessionIdRef.current && terminal) {
          console.log('[DEBUG] Writing to terminal:', event.payload.data)
          terminal.write(event.payload.data)
        } else {
          console.log('[DEBUG] Skipping terminal write - session mismatch or no terminal')
        }
      })

      setIsTerminalReady(true)

      // Auto-start or resume Claude session if project is selected
      if (selectedProject) {
        if (selectedSessionId) {
          console.log('[TerminalInterface] Resuming Claude session:', selectedSessionId, 'for project:', selectedProject.name)
          await resumeSession(selectedSessionId)
        } else {
          console.log('[TerminalInterface] Auto-starting Claude session for project:', selectedProject.name)
          await startClaudeSession()
        }
      }

      // Store the unlisten function for cleanup
      return unlisten

    } catch (error) {
      console.error('Failed to initialize terminal:', error)
    }
  }

  const startClaudeSession = async () => {
    if (!selectedProject) return

    try {
      let sessionId: string

      if (selectedSessionId) {
        // Resume existing session
        sessionId = await invoke<string>('resume_claude_session', {
          sessionId: selectedSessionId,
          projectPath: selectedProject.path
        })
      } else {
        // Start new session
        sessionId = await invoke<string>('start_claude_session', {
          projectPath: selectedProject.path
        })
      }

      // Use React's flushSync to ensure immediate state update
      flushSync(() => {
        setActiveSessionId(sessionId)
      })
      activeSessionIdRef.current = sessionId
      console.log('Set active session ID:', sessionId)

      // Add to sessions list
      const newSession: TerminalSession = {
        id: sessionId,
        name: selectedSessionId ? `Resumed ${selectedSessionId.slice(0, 8)}` : 'New Session',
        active: true,
        projectPath: selectedProject.path
      }

      setSessions(prev => {
        const updated = prev.map(s => ({ ...s, active: false }))
        const newSessions = [...updated, newSession]
        
        // Notify parent that terminal is now active
        if (onTerminalStateChange) {
          onTerminalStateChange(true)
        }
        
        return newSessions
      })

    } catch (error) {
      console.error('Failed to start Claude session:', error)
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.write('\r\n\x1b[31mError: Failed to start Claude session\x1b[0m\r\n')
      }
    }
  }

  const resumeSession = async (sessionId: string) => {
    console.log('[TerminalInterface] resumeSession called with sessionId:', sessionId, 'selectedProject:', selectedProject?.name)
    if (!selectedProject) return

    try {
      console.log('[TerminalInterface] Calling backend resume_claude_session')
      const resumedSessionId = await invoke<string>('resume_claude_session', {
        sessionId: sessionId,
        projectPath: selectedProject.path
      })

      console.log('[TerminalInterface] Successfully resumed session:', resumedSessionId)
      console.log('[TerminalInterface] Setting activeSessionId to:', resumedSessionId)
      
      // Use React's flushSync to ensure immediate state update
      flushSync(() => {
        setActiveSessionId(resumedSessionId)
      })
      activeSessionIdRef.current = resumedSessionId

      // Update sessions list - add session if it doesn't exist, mark as active
      setSessions(prev => {
        const existingSession = prev.find(s => s.id === resumedSessionId)
        if (existingSession) {
          return prev.map(s => ({
            ...s,
            active: s.id === resumedSessionId
          }))
        } else {
          // Add the resumed session to the list
          const newSession = {
            id: resumedSessionId,
            name: `Resumed ${resumedSessionId.slice(0, 8)}`,
            active: true,
            projectPath: selectedProject.path
          }
          return [...prev.map(s => ({ ...s, active: false })), newSession]
        }
      })

      // Notify parent that terminal is now active
      if (onTerminalStateChange) {
        onTerminalStateChange(true)
      }

    } catch (error) {
      console.error('Failed to resume session:', error)
    }
  }

  const createNewSession = async () => {
    if (!selectedProject) return
    
    // Create a completely new session (not resumed)
    try {
      const newSessionId = await invoke<string>('start_claude_session', {
        projectPath: selectedProject.path
      })

      // Use React's flushSync to ensure immediate state update
      flushSync(() => {
        setActiveSessionId(newSessionId)
      })
      activeSessionIdRef.current = newSessionId
      console.log('Created new session ID:', newSessionId)

      // Add to sessions list
      const newSession: TerminalSession = {
        id: newSessionId,
        name: `Session ${newSessionId.slice(0, 8)}`,
        active: true,
        projectPath: selectedProject.path
      }

      setSessions(prev => {
        const updated = prev.map(s => ({ ...s, active: false }))
        const newSessions = [...updated, newSession]
        
        // Notify parent that terminal is now active
        if (onTerminalStateChange) {
          onTerminalStateChange(true)
        }
        
        return newSessions
      })

    } catch (error) {
      console.error('Failed to create new session:', error)
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.write('\r\n\x1b[31mError: Failed to create new session\x1b[0m\r\n')
      }
    }
  }

  const closeSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent tab selection when clicking close
    
    try {
      // Close the terminal session on the backend
      await invoke('close_terminal_session', { sessionId })
      
      // Check if we're closing the active session
      const isClosingActiveSession = sessionId === activeSessionId
      
      // Remove from sessions list
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== sessionId)
        
        // If we're closing the active session, handle the switch
        if (isClosingActiveSession) {
          if (filtered.length > 0) {
            // Activate the most recent session
            const newActive = filtered[filtered.length - 1]
            setActiveSessionId(newActive.id)
            activeSessionIdRef.current = newActive.id
            
            // Clear the terminal and switch to the new session
            if (terminalInstanceRef.current) {
              terminalInstanceRef.current.clear()
              terminalInstanceRef.current.write(`\r\n\x1b[32mSwitched to session: ${newActive.name}\x1b[0m\r\n`)
            }
            
            // Resume the new active session
            setTimeout(() => {
              resumeSession(newActive.id)
            }, 100)
            
            return filtered.map(s => ({
              ...s,
              active: s.id === newActive.id
            }))
          } else {
            // No sessions left - clear terminal and reset state
            if (terminalInstanceRef.current) {
              terminalInstanceRef.current.clear()
              terminalInstanceRef.current.write('\r\n\x1b[33mNo active sessions. Create a new session to continue.\x1b[0m\r\n')
            }
            flushSync(() => {
              setActiveSessionId(null)
            })
            activeSessionIdRef.current = null
            
            // Notify parent that terminal is no longer active
            if (onTerminalStateChange) {
              onTerminalStateChange(false)
            }
            
            return []
          }
        }
        
        return filtered
      })
      
    } catch (error) {
      console.error('Failed to close session:', error)
    }
  }

  const handleSearch = (searchTerm: string) => {
    if (searchAddonRef.current && terminalInstanceRef.current) {
      if (searchTerm) {
        searchAddonRef.current.findNext(searchTerm)
      }
    }
  }

  const toggleFullscreen = () => {
    // Toggle terminal fullscreen mode by targeting the main container
    const mainContainer = terminalRef.current?.closest('.h-full.flex.flex-col.bg-gray-900')
    if (mainContainer) {
      const isFullscreen = mainContainer.classList.contains('fixed') && 
                          mainContainer.classList.contains('inset-0') && 
                          mainContainer.classList.contains('z-50')
      
      if (isFullscreen) {
        // Exit fullscreen
        mainContainer.classList.remove('fixed', 'inset-0', 'z-50')
        mainContainer.classList.add('h-full')
      } else {
        // Enter fullscreen
        mainContainer.classList.remove('h-full')
        mainContainer.classList.add('fixed', 'inset-0', 'z-50')
      }
      
      // Refit terminal after fullscreen toggle
      setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit()
        }
      }, 100)
    }
  }

  const cleanup = (preserveHistory = false) => {
    if (terminalInstanceRef.current) {
      // Preserve terminal history if requested
      if (preserveHistory) {
        try {
          const buffer = terminalInstanceRef.current.buffer.active
          let history = ''
          for (let i = 0; i < buffer.length; i++) {
            history += buffer.getLine(i)?.translateToString() + '\n'
          }
          setTerminalHistory(history)
          console.log('[TerminalInterface] Preserved terminal history:', history.length, 'characters')
        } catch (error) {
          console.warn('[TerminalInterface] Failed to preserve terminal history:', error)
        }
      }
      
      terminalInstanceRef.current.dispose()
      terminalInstanceRef.current = null
    }
    fitAddonRef.current = null
    searchAddonRef.current = null
    setIsTerminalReady(false)
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <TerminalIcon size={48} className="text-gray-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-200 mb-2">No Project Selected</h3>
          <p className="text-gray-400">
            Select a project from the Projects tab to start a Claude terminal session.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Terminal Header */}
      <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-semibold text-gray-200 flex items-center">
            <TerminalIcon size={20} className="mr-2" />
            Claude Code Terminal
          </h2>
          <span className="text-sm text-gray-400">
            {selectedProject.name}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Search toggle */}
          <button
            onClick={() => setIsSearchVisible(!isSearchVisible)}
            className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title="Search terminal output"
          >
            <Search size={16} />
          </button>

          {/* New session */}
          <button
            onClick={createNewSession}
            className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title="New terminal session"
          >
            <Plus size={16} />
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title="Toggle fullscreen"
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>

      {/* Search bar */}
      {isSearchVisible && (
        <div className="p-3 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(searchTerm)
                } else if (e.key === 'Escape') {
                  setIsSearchVisible(false)
                  setSearchTerm('')
                }
              }}
              className="flex-1 px-3 py-1 bg-gray-700 text-gray-200 border border-gray-600 rounded focus:outline-none focus:border-blue-500"
              placeholder="Search terminal output... (Enter to search, Esc to close)"
              autoFocus
            />
            <button
              onClick={() => handleSearch(searchTerm)}
              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Find
            </button>
          </div>
        </div>
      )}

      {/* Session tabs */}
      {sessions.length > 0 && (
        <div className="flex items-center space-x-1 p-2 bg-gray-800 border-b border-gray-700 overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center group rounded transition-colors ${
                session.active
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <button
                onClick={() => resumeSession(session.id)}
                className="px-3 py-1 text-sm whitespace-nowrap flex-1 text-left"
              >
                {session.name}
              </button>
              <button
                onClick={(e) => closeSession(session.id, e)}
                className={`px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 rounded-r ${
                  session.active ? 'text-white' : 'text-gray-400'
                }`}
                title="Close session"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Terminal container */}
      <div className="flex-1 relative">
        <div
          ref={terminalRef}
          className="w-full h-full"
          style={{ 
            minHeight: '400px',
            textDecoration: 'none',
            textDecorationLine: 'none'
          }}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-400">
        <div className="flex items-center space-x-4">
          <span>Ready</span>
          {activeSessionId && (
            <span>Session: {activeSessionId.slice(0, 8)}</span>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <span>Claude Code Terminal</span>
        </div>
      </div>
    </div>
  )
}