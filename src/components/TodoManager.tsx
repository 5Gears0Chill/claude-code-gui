'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CheckSquare, Square, Clock } from 'lucide-react'

interface Todo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
  created_at: string
  session_id?: string
}

interface TodoManagerProps {
  selectedProject: any
  activeSessionId?: string
}

export function TodoManager({ selectedProject, activeSessionId }: TodoManagerProps) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (selectedProject) {
      loadTodos()
    }
  }, [selectedProject, activeSessionId])

  // Listen for real-time todo updates from Claude
  useEffect(() => {
    if (!selectedProject) return

    const setupTodoListener = async () => {
      const window = getCurrentWindow()
      const unlisten = await window.listen<any>('todos_updated', (event) => {
        console.log('[TodoManager] Received todos update:', event.payload)
        console.log('[TodoManager] Current project path:', selectedProject.path)
        console.log('[TodoManager] Current activeSessionId:', activeSessionId)
        
        if (event.payload.projectPath === selectedProject.path && 
            event.payload.sessionId === activeSessionId) {
          console.log('[TodoManager] Event matches current session, updating todos')
          // Filter todos to only show those for the active session
          const sessionTodos = (event.payload.todos || []).filter(
            (todo: Todo) => todo.session_id === activeSessionId
          )
          console.log('[TodoManager] Filtered session todos:', sessionTodos)
          setTodos(sessionTodos)
        } else {
          console.log('[TodoManager] Event does not match current session - ignoring')
        }
      })

      return unlisten
    }

    let unlisten: (() => void) | null = null
    setupTodoListener().then((fn) => { unlisten = fn })

    return () => {
      if (unlisten) unlisten()
    }
  }, [selectedProject])

  const loadTodos = async () => {
    if (!selectedProject) return
    
    console.log('[TodoManager] Loading todos for project:', selectedProject.path, 'activeSessionId:', activeSessionId)
    setLoading(true)
    try {
      console.log('[TodoManager] Calling load_project_todos with path:', selectedProject.path)
      const loadedTodos = await invoke<Todo[]>('load_project_todos', {
        projectPath: selectedProject.path
      })
      
      console.log('[TodoManager] Loaded todos from backend:', loadedTodos)
      console.log('[TodoManager] Available session IDs in todos:', Array.from(new Set(loadedTodos.map(t => t.session_id))))
      
      // Filter todos to only show those for the active session
      const sessionTodos = activeSessionId 
        ? loadedTodos.filter(todo => todo.session_id === activeSessionId)
        : loadedTodos.filter(todo => !todo.session_id) // Show unassigned todos if no active session
      
      console.log('[TodoManager] Filtered session todos:', sessionTodos)
      console.log('[TodoManager] Current activeSessionId:', activeSessionId)
      console.log('[TodoManager] Filter criteria: session_id should equal activeSessionId')
      
      setTodos(sessionTodos)
    } catch (error) {
      console.error('[TodoManager] Failed to load todos:', error)
      setTodos([])
    } finally {
      setLoading(false)
    }
  }


  // Removed interactive functions - todos are now read-only

  const filteredTodos = todos.filter(todo => 
    filter === 'all' || todo.status === filter
  )

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-500'
      case 'medium': return 'text-yellow-500'
      case 'low': return 'text-green-500'
      default: return 'text-muted-foreground'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckSquare className="text-green-500" size={20} />
      case 'in_progress': return <Clock className="text-yellow-500" size={20} />
      default: return <Square className="text-muted-foreground" size={20} />
    }
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <CheckSquare size={48} className="text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No Project Selected</h3>
          <p className="text-muted-foreground">
            Select a project from the Projects tab to manage todos.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <h2 className="text-2xl font-semibold text-foreground">Session Todos (Read Only)</h2>
        <div className="mt-2 space-y-1">
          <p className="text-muted-foreground">
            Project: {selectedProject.name}
          </p>
          {activeSessionId ? (
            <p className="text-sm text-blue-400">
              Active Session: {activeSessionId.slice(0, 8)}
            </p>
          ) : (
            <p className="text-sm text-yellow-400">
              No active terminal session
            </p>
          )}
        </div>
      </div>

      {!activeSessionId && (
        <div className="p-6 border-b border-border bg-yellow-50 dark:bg-yellow-900/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                No Active Session
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                Todos are generated by Claude's TodoWrite tool and are read-only. Start a terminal session to see session-specific todos.
              </p>
            </div>
            <div className="text-sm text-yellow-700 dark:text-yellow-300">
              Navigate to Terminal tab to start a session
            </div>
          </div>
        </div>
      )}

      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="text-sm text-muted-foreground">Debug Info:</span>
            <span className="text-xs ml-2">Active Session: {activeSessionId || 'None'}</span>
          </div>
          <button
            onClick={loadTodos}
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Refresh Todos
          </button>
        </div>

        <div className="flex space-x-2">
          {['all', 'pending', 'in_progress', 'completed'].map((filterOption) => (
            <button
              key={filterOption}
              onClick={() => setFilter(filterOption as any)}
              className={`px-3 py-1 rounded-lg capitalize transition-colors ${
                filter === filterOption
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
            >
              {filterOption.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
          </div>
        ) : filteredTodos.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-center">
            <div>
              <CheckSquare size={48} className="text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No Todos</h3>
              <p className="text-muted-foreground">
                {filter === 'all' 
                  ? (activeSessionId 
                      ? 'No todos found for this session. Todos are created when Claude uses the TodoWrite tool and are read-only.'
                      : 'Start a terminal session to see read-only todos generated by Claude.')
                  : `No ${filter.replace('_', ' ')} todos found for this session.`
                }
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTodos.map((todo) => (
              <div
                key={todo.id}
                className={`p-4 bg-card border border-border rounded-lg ${
                  todo.status === 'completed' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5">
                    {getStatusIcon(todo.status)}
                  </div>
                  <div className="flex-1">
                    <p className={`text-foreground ${
                      todo.status === 'completed' ? 'line-through' : ''
                    }`}>
                      {todo.content}
                    </p>
                    <div className="flex items-center space-x-4 mt-2">
                      <span className={`text-xs font-medium ${getPriorityColor(todo.priority)}`}>
                        {todo.priority.toUpperCase()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {todo.status.replace('_', ' ').toUpperCase()}
                      </span>
                      <span className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                        🤖 Claude Generated
                      </span>
                      <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                        Read Only
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}