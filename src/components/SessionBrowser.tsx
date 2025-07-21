'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { MessageSquare, Clock, ArrowRight, History } from 'lucide-react'

interface Session {
  id: string
  name: string
  lastMessage: string
  timestamp: string
  messageCount: number
}

interface SessionBrowserProps {
  selectedProject: any
  onViewChange: (view: 'projects' | 'terminal' | 'todos' | 'files' | 'sessions' | 'ide' | 'claude-md') => void
  onSelectSession: (sessionId: string) => void
}

export function SessionBrowser({ selectedProject, onViewChange, onSelectSession }: SessionBrowserProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (selectedProject) {
      loadSessions()
    }
  }, [selectedProject])

  const loadSessions = async () => {
    if (!selectedProject) return

    try {
      setLoading(true)
      // Load real sessions from the project directory
      const sessionsData = await invoke<any[]>('get_project_sessions', {
        projectPath: selectedProject.path
      })
      
      // Convert the data to our Session interface
      const realSessions: Session[] = sessionsData.map(session => ({
        id: session.id || 'unknown',
        name: session.name || 'Unnamed Session',
        lastMessage: session.lastMessage || 'No messages',
        timestamp: session.timestamp || new Date().toISOString(),
        messageCount: session.messageCount || 0
      }))
      
      setSessions(realSessions)
    } catch (error) {
      console.error('Failed to load sessions:', error)
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffDays = Math.floor(diffHours / 24)

      if (diffDays > 0) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
      } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
      } else {
        return 'Just now'
      }
    } catch {
      return 'Unknown'
    }
  }

  const handleSessionClick = (session: Session) => {
    onSelectSession(session.id)
    onViewChange('terminal')
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <History size={48} className="text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No Project Selected</h3>
          <p className="text-muted-foreground">
            Select a project from the Projects tab to view its sessions.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Sessions</h2>
            <p className="text-muted-foreground mt-2">
              Project: {selectedProject.name}
            </p>
          </div>
          <button
            onClick={() => onViewChange('terminal')}
            className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            <MessageSquare size={16} />
            <span>New Chat</span>
          </button>
        </div>
        <p className="text-muted-foreground mt-2">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} found
        </p>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <History size={48} className="text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No Sessions Found</h3>
            <p className="text-muted-foreground max-w-md mb-4">
              No conversation sessions were found for this project. 
              Start a new chat to create your first session.
            </p>
            <button
              onClick={() => onViewChange('terminal')}
              className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <MessageSquare size={16} />
              <span>Start New Chat</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSessionClick(session)}
                className="p-4 bg-card border border-border rounded-lg hover:bg-accent cursor-pointer transition-colors group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1">
                    <MessageSquare size={20} className="text-primary mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground group-hover:text-accent-foreground">
                        {session.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {session.lastMessage}
                      </p>
                      <div className="flex items-center space-x-4 mt-2">
                        <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                          <Clock size={12} />
                          <span>{formatTimestamp(session.timestamp)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={16} className="text-muted-foreground group-hover:text-accent-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}