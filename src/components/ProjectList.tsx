'use client'

import { RefreshCw, Folder, Clock, Plus, MessageSquare, FileText, FolderOpen, GitBranch, Code, Settings, Check } from 'lucide-react'
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Project {
  name: string
  path: string
  last_modified: string
}

interface ProjectListProps {
  projects: Project[]
  onSelectProject: (project: Project) => void
  onRefresh: () => void
  loading: boolean
  onViewChange: (view: 'projects' | 'terminal' | 'todos' | 'files' | 'sessions' | 'ide' | 'claude-md') => void
}

interface ProjectSetupOptions {
  path: string
  projectName: string
  initGit: boolean
  createClaude: boolean
  projectType: 'custom' | 'react' | 'nextjs' | 'python' | 'node' | 'rust' | 'empty'
  openInIDE: boolean
  selectedIDE?: string
}

interface NewProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreateProject: (options: ProjectSetupOptions) => void
}

function ProjectPath({ project }: { project: Project }) {
  const [realPath, setRealPath] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const getRealPath = async () => {
      setLoading(true)
      try {
        const real = await invoke<string | null>('get_real_project_path', { 
          claudeProjectPath: project.path 
        })
        setRealPath(real || project.path)
      } catch (error) {
        console.error('Failed to get real project path:', error)
        setRealPath(project.path)
      } finally {
        setLoading(false)
      }
    }

    getRealPath()
  }, [project.path])

  if (loading) {
    return (
      <div className="flex items-center space-x-2 text-sm text-muted-foreground mt-1">
        <div className="animate-spin rounded-full h-3 w-3 border border-muted-foreground border-t-transparent"></div>
        <span>Loading path...</span>
      </div>
    )
  }

  return (
    <p className="text-sm text-muted-foreground mt-1 font-mono truncate">
      {realPath}
    </p>
  )
}

function NewProjectDialog({ isOpen, onClose, onCreateProject }: NewProjectDialogProps) {
  const [options, setOptions] = useState<ProjectSetupOptions>({
    path: '',
    projectName: '',
    initGit: true,
    createClaude: true,
    projectType: 'empty',
    openInIDE: false,
    selectedIDE: undefined
  })
  const [loading, setLoading] = useState(false)
  const [availableIDEs, setAvailableIDEs] = useState<any[]>([])
  const [step, setStep] = useState(1) // 1: Basic Info, 2: Advanced Options

  const projectTypes = [
    { id: 'empty', name: 'Empty Project', description: 'Start with an empty directory', icon: Folder },
    { id: 'react', name: 'React App', description: 'Create React application with Vite', icon: Code },
    { id: 'nextjs', name: 'Next.js App', description: 'Full-stack React framework', icon: Code },
    { id: 'python', name: 'Python Project', description: 'Python project with virtual environment', icon: Code },
    { id: 'node', name: 'Node.js Project', description: 'Node.js project with npm init', icon: Code },
    { id: 'rust', name: 'Rust Project', description: 'Rust project with Cargo', icon: Code },
    { id: 'custom', name: 'Existing Project', description: 'Add Claude to existing project', icon: FolderOpen }
  ]

  // Load available IDEs when dialog opens
  useEffect(() => {
    if (isOpen) {
      invoke<any[]>('detect_available_ides').then((ides) => {
        setAvailableIDEs(ides.filter(ide => ide.available))
      })
    }
  }, [isOpen])

  const handleDirectorySelect = async () => {
    try {
      // Use Tauri dialog to select directory
      const selected = await invoke<string | null>('select_directory')
      if (selected) {
        setOptions(prev => ({ 
          ...prev, 
          path: selected,
          projectName: selected.split('/').pop() || ''
        }))
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!options.path.trim()) return

    setLoading(true)
    try {
      await onCreateProject(options)
      // Reset form
      setOptions({
        path: '',
        projectName: '',
        initGit: true,
        createClaude: true,
        projectType: 'empty',
        openInIDE: false,
        selectedIDE: undefined
      })
      setStep(1)
      onClose()
    } catch (error) {
      console.error('Failed to create project:', error)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-semibold text-foreground">Create New Project</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Set up a new project with Claude Code integration
                </p>
              </div>
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {step > 1 ? <Check size={12} /> : '1'}
                </div>
                <div className="w-8 h-px bg-border"></div>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  2
                </div>
              </div>
            </div>

            {step === 1 && (
              <div className="space-y-6">
                {/* Project Location */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Project Location
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={options.path}
                      onChange={(e) => setOptions(prev => ({ ...prev, path: e.target.value }))}
                      placeholder="/path/to/your/project"
                      className="flex-1 p-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={handleDirectorySelect}
                      className="px-4 py-3 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity flex items-center space-x-2"
                    >
                      <FolderOpen size={16} />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>

                {/* Project Name */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={options.projectName}
                    onChange={(e) => setOptions(prev => ({ ...prev, projectName: e.target.value }))}
                    placeholder="my-awesome-project"
                    className="w-full p-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={loading}
                  />
                </div>

                {/* Project Type */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Project Type
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {projectTypes.map((type) => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setOptions(prev => ({ ...prev, projectType: type.id as any }))}
                        className={`p-3 border rounded-lg text-left transition-all ${
                          options.projectType === type.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <type.icon size={20} className={options.projectType === type.id ? 'text-primary' : 'text-muted-foreground'} />
                          <div>
                            <div className="font-medium text-sm">{type.name}</div>
                            <div className="text-xs text-muted-foreground mt-1">{type.description}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    disabled={!options.path.trim()}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Next: Advanced Options
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                {/* Quick Setup Options */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Project Setup
                  </label>
                  <div className="space-y-3">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.initGit}
                        onChange={(e) => setOptions(prev => ({ ...prev, initGit: e.target.checked }))}
                        className="rounded border-border"
                      />
                      <div className="flex items-center space-x-2">
                        <GitBranch size={16} className="text-muted-foreground" />
                        <span className="text-sm">Initialize Git repository</span>
                      </div>
                    </label>

                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.createClaude}
                        onChange={(e) => setOptions(prev => ({ ...prev, createClaude: e.target.checked }))}
                        className="rounded border-border"
                      />
                      <div className="flex items-center space-x-2">
                        <FileText size={16} className="text-muted-foreground" />
                        <span className="text-sm">Create CLAUDE.md template</span>
                      </div>
                    </label>

                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.openInIDE}
                        onChange={(e) => setOptions(prev => ({ ...prev, openInIDE: e.target.checked }))}
                        className="rounded border-border"
                      />
                      <div className="flex items-center space-x-2">
                        <Code size={16} className="text-muted-foreground" />
                        <span className="text-sm">Open in IDE after creation</span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* IDE Selection */}
                {options.openInIDE && availableIDEs.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Select IDE
                    </label>
                    <select
                      value={options.selectedIDE || ''}
                      onChange={(e) => setOptions(prev => ({ ...prev, selectedIDE: e.target.value }))}
                      className="w-full p-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Choose an IDE...</option>
                      {availableIDEs.map((ide) => (
                        <option key={ide.command} value={ide.command}>
                          {ide.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !options.path.trim()}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center space-x-2"
                  >
                    {loading && <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent"></div>}
                    <span>{loading ? 'Creating Project...' : 'Create Project'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

export function ProjectList({ projects, onSelectProject, onRefresh, loading, onViewChange }: ProjectListProps) {
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)

  const formatDate = (dateString: string) => {
    try {
      // Handle the Debug format that Rust returns
      if (dateString.includes('SystemTime')) {
        return 'Recently modified'
      }
      
      const date = new Date(dateString)
      if (isNaN(date.getTime())) {
        return 'Unknown date'
      }
      
      const now = new Date()
      const diffTime = Math.abs(now.getTime() - date.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.ceil(diffDays / 7)} weeks ago`
      if (diffDays < 365) return `${Math.ceil(diffDays / 30)} months ago`
      
      return date.toLocaleDateString()
    } catch {
      return 'Unknown date'
    }
  }

  const getProjectName = (project: Project) => {
    // Clean up the encoded project name
    const name = project.name
    if (name.startsWith('-')) {
      // Decode the path-like name
      const parts = name.slice(1).split('-')
      return parts[parts.length - 1] || name
    }
    return name
  }

  const handleCreateProject = async (options: ProjectSetupOptions) => {
    try {
      const result = await invoke<string>('create_enhanced_project', { options })
      console.log('Project created:', result)
      
      // Refresh the project list to include the new project
      await onRefresh()
      
      // After refresh, find and select the newly created project
      // We need a small delay to ensure the project list is updated
      setTimeout(async () => {
        try {
          // Get the updated projects list
          const updatedProjects = await invoke<Project[]>('get_claude_projects')
          
          // Find the project that matches our created path
          const newProject = updatedProjects.find(p => {
            // Try to match by project name or path
            return p.name.toLowerCase().includes(options.projectName.toLowerCase()) ||
                   p.path.includes(options.projectName)
          })
          
          if (newProject) {
            // Select the project and navigate to terminal
            onSelectProject(newProject)
            onViewChange('terminal')
          } else {
            console.warn('Could not find newly created project in list')
          }
        } catch (error) {
          console.error('Failed to auto-select new project:', error)
        }
      }, 1000) // 1 second delay to ensure project is registered
      
    } catch (error) {
      console.error('Failed to create project:', error)
      throw error // Re-throw to let the dialog handle the error
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Projects</h2>
            <p className="text-muted-foreground mt-1">
              Found {projects.length} Claude Code project{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowNewProjectDialog(true)}
              className="flex items-center space-x-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              <span>New Project</span>
            </button>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center space-x-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Folder size={48} className="text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No Projects Found</h3>
            <p className="text-muted-foreground max-w-md mb-4">
              No Claude Code projects were found. Create your first project to get started.
            </p>
            <button
              onClick={() => setShowNewProjectDialog(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              <span>Create New Project</span>
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {projects.map((project, index) => (
              <div
                key={index}
                onClick={() => {
                  onSelectProject(project)
                  onViewChange('sessions')
                }}
                className="group p-4 bg-card border border-border rounded-lg hover:bg-accent cursor-pointer transition-all hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                      <Folder size={20} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground text-lg group-hover:text-primary transition-colors">
                        {getProjectName(project)}
                      </h3>
                      <ProjectPath project={project} />
                      <div className="flex items-center space-x-4 mt-2">
                        <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                          <Clock size={12} />
                          <span>{formatDate(project.last_modified)}</span>
                        </div>
                        <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                          <MessageSquare size={12} />
                          <span>Click to view sessions</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <NewProjectDialog
        isOpen={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onCreateProject={handleCreateProject}
      />
    </div>
  )
}