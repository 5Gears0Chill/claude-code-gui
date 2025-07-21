'use client'

import { Folder, Terminal, CheckSquare, FileText, Settings, History, Code, BookOpen } from 'lucide-react'

interface SidebarProps {
  activeView: string
  onViewChange: (view: 'projects' | 'terminal' | 'todos' | 'files' | 'sessions' | 'ide' | 'claude-md') => void
  selectedProject: any
}

export function Sidebar({ activeView, onViewChange, selectedProject }: SidebarProps) {
  const menuItems = [
    { id: 'projects', label: 'Projects', icon: Folder },
    { id: 'claude-md', label: 'CLAUDE.md', icon: BookOpen, disabled: !selectedProject },
    { id: 'sessions', label: 'Sessions', icon: History, disabled: !selectedProject },
    { id: 'terminal', label: 'Terminal', icon: Terminal, disabled: !selectedProject },
    { id: 'todos', label: 'Todos', icon: CheckSquare, disabled: !selectedProject },
    { id: 'files', label: 'Files', icon: FileText, disabled: !selectedProject },
    { id: 'ide', label: 'Settings', icon: Settings },
  ]

  return (
    <div className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Claude Code GUI</h1>
        {selectedProject && (
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {selectedProject.name}
          </p>
        )}
      </div>
      
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.id}>
                <button
                  onClick={() => !item.disabled && onViewChange(item.id as any)}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                    activeView === item.id
                      ? 'bg-primary text-primary-foreground'
                      : item.disabled
                      ? 'text-muted-foreground cursor-not-allowed opacity-50'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                  disabled={item.disabled}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}