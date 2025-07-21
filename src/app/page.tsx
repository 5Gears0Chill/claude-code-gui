'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from '@/components/Sidebar'
import { ProjectList } from '@/components/ProjectList'
import { TodoManager } from '@/components/TodoManager'
import { FileExplorer } from '@/components/FileExplorer'
import { SessionBrowser } from '@/components/SessionBrowser'
import { SystemSettings } from '@/components/SystemSettings'
import { ClaudeMdEditor } from '@/components/ClaudeMdEditor'
import { SplashScreen } from '@/components/SplashScreen'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import dynamic from 'next/dynamic'

// Dynamically import TerminalInterface to avoid SSR issues with xterm.js
const TerminalInterface = dynamic(() => import('@/components/TerminalInterface').then(mod => ({ default: mod.TerminalInterface })), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <LoadingSpinner message="Loading terminal..." />
    </div>
  )
})

// Dynamically import MinimizedTerminal 
const MinimizedTerminal = dynamic(() => import('@/components/MinimizedTerminal').then(mod => ({ default: mod.MinimizedTerminal })), {
  ssr: false
})

interface Project {
  name: string
  path: string
  last_modified: string
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined)
  const [activeView, setActiveView] = useState<'projects' | 'terminal' | 'todos' | 'files' | 'sessions' | 'ide' | 'claude-md'>('projects')
  const [loading, setLoading] = useState(true)
  const [terminalMinimized, setTerminalMinimized] = useState(false)
  const [hasActiveTerminal, setHasActiveTerminal] = useState(false)
  const [showSplash, setShowSplash] = useState(true)
  const [appInitialized, setAppInitialized] = useState(false)

  useEffect(() => {
    // Initialize app after splash screen
    if (appInitialized) {
      loadProjects()
    }
  }, [appInitialized])

  const handleSplashComplete = () => {
    setShowSplash(false)
    setAppInitialized(true)
  }

  const loadProjects = async () => {
    try {
      const result = await invoke<Project[]>('get_claude_projects')
      setProjects(result)
    } catch (error) {
      console.error('Failed to load projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewChange = (newView: 'projects' | 'terminal' | 'todos' | 'files' | 'sessions' | 'ide' | 'claude-md') => {
    // If switching away from terminal and we have an active terminal session, minimize it
    if (activeView === 'terminal' && newView !== 'terminal' && hasActiveTerminal) {
      setTerminalMinimized(true)
    }
    
    // If switching to terminal, restore from minimized state
    if (newView === 'terminal') {
      setTerminalMinimized(false)
    }
    
    setActiveView(newView)
  }

  const handleTerminalStateChange = (isActive: boolean) => {
    setHasActiveTerminal(isActive)
    // If terminal becomes inactive while minimized, hide the minimized version
    if (!isActive && terminalMinimized) {
      setTerminalMinimized(false)
    }
  }

  const renderMainContent = () => {
    switch (activeView) {
      case 'projects':
        return (
          <ProjectList 
            projects={projects} 
            onSelectProject={setSelectedProject}
            onRefresh={loadProjects}
            loading={loading}
            onViewChange={handleViewChange}
          />
        )
      case 'todos':
        return (
          <TodoManager 
            selectedProject={selectedProject}
            activeSessionId={hasActiveTerminal ? selectedSessionId : undefined}
          />
        )
      case 'files':
        return (
          <FileExplorer 
            selectedProject={selectedProject}
          />
        )
      case 'sessions':
        return (
          <SessionBrowser 
            selectedProject={selectedProject}
            onViewChange={handleViewChange}
            onSelectSession={setSelectedSessionId}
          />
        )
      case 'ide':
        return (
          <SystemSettings 
            selectedProject={selectedProject}
          />
        )
      case 'claude-md':
        return (
          <ClaudeMdEditor 
            selectedProject={selectedProject}
          />
        )
      case 'terminal':
        // Terminal case is handled separately below to keep it always mounted
        return null
      default:
        return <div>Select a view from the sidebar</div>
    }
  }

  return (
    <>
      <SplashScreen 
        isVisible={showSplash} 
        onComplete={handleSplashComplete} 
      />
      
      <div className={`flex h-screen bg-background ${showSplash ? 'hidden' : 'block'}`}>
      <Sidebar 
        activeView={activeView}
        onViewChange={handleViewChange}
        selectedProject={selectedProject}
      />
      <main className="flex-1 overflow-hidden">
        {/* Always render TerminalInterface but show/hide it */}
        <div className={`h-full ${activeView === 'terminal' ? 'block' : 'hidden'}`}>
          <TerminalInterface 
            selectedProject={selectedProject}
            selectedSessionId={selectedSessionId}
            onTerminalStateChange={handleTerminalStateChange}
          />
        </div>
        
        {/* Render other content when not showing terminal */}
        {activeView !== 'terminal' && (
          <div className="h-full">
            {renderMainContent()}
          </div>
        )}
      </main>
      
      {/* Minimized Terminal Picture-in-Picture */}
      {terminalMinimized && hasActiveTerminal && selectedProject && (
        <MinimizedTerminal
          selectedProject={selectedProject}
          selectedSessionId={selectedSessionId}
          onRestore={() => handleViewChange('terminal')}
          onClose={() => {
            setTerminalMinimized(false)
            setHasActiveTerminal(false)
          }}
        />
      )}
      </div>
    </>
  )
}