'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { 
  Settings, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  RefreshCw,
  Download,
  BarChart3,
  Users,
  Clock,
  Cpu,
  HardDrive,
  Zap,
  TrendingUp,
  Calendar,
  Activity
} from 'lucide-react'

interface SystemInfo {
  node_version: string
  npm_version: string
  claude_npm_info: any
  platform: string
  arch: string
}

interface ClaudeConfig {
  allowedTools: string[]
  hasTrustDialogAccepted: boolean
  hasCompletedProjectOnboarding: boolean
  model?: string
  [key: string]: any
}

interface UsageStats {
  total_input_tokens: number
  total_output_tokens: number
  total_cache_creation_tokens: number
  total_cache_read_tokens: number
  session_count: number
  models_used: Record<string, number>
  daily_usage: Record<string, DailyUsage>
}

interface DailyUsage {
  input_tokens: number
  output_tokens: number
  sessions: number
}

interface SystemSettingsProps {
  selectedProject?: any
}

export function SystemSettings({ selectedProject }: SystemSettingsProps) {
  const [claudeVersion, setClaudeVersion] = useState<string>('')
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [claudeConfig, setClaudeConfig] = useState<ClaudeConfig | null>(null)
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState({
    version: false,
    system: false,
    config: false,
    usage: false
  })
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'usage' | 'system'>('overview')

  useEffect(() => {
    loadAllData()
  }, [selectedProject])

  const loadAllData = async () => {
    await Promise.all([
      loadClaudeVersion(),
      loadSystemInfo(),
      loadClaudeConfig(),
      loadUsageStats()
    ])
  }

  const loadClaudeVersion = async () => {
    setLoading(prev => ({ ...prev, version: true }))
    try {
      const version = await invoke<string>('get_claude_version')
      setClaudeVersion(version)
    } catch (error) {
      console.error('Failed to get Claude version:', error)
      setClaudeVersion('Not available')
    } finally {
      setLoading(prev => ({ ...prev, version: false }))
    }
  }

  const loadSystemInfo = async () => {
    setLoading(prev => ({ ...prev, system: true }))
    try {
      const info = await invoke<SystemInfo>('get_system_info')
      setSystemInfo(info)
    } catch (error) {
      console.error('Failed to get system info:', error)
    } finally {
      setLoading(prev => ({ ...prev, system: false }))
    }
  }

  const loadClaudeConfig = async () => {
    setLoading(prev => ({ ...prev, config: true }))
    try {
      const config = await invoke<ClaudeConfig>('get_claude_config')
      setClaudeConfig(config)
    } catch (error) {
      console.error('Failed to get Claude config:', error)
    } finally {
      setLoading(prev => ({ ...prev, config: false }))
    }
  }

  const loadUsageStats = async () => {
    setLoading(prev => ({ ...prev, usage: true }))
    try {
      const stats = await invoke<UsageStats>('get_usage_statistics', {
        projectPath: selectedProject?.path
      })
      setUsageStats(stats)
    } catch (error) {
      console.error('Failed to get usage stats:', error)
    } finally {
      setLoading(prev => ({ ...prev, usage: false }))
    }
  }

  const getSystemStatus = () => {
    if (!claudeVersion || claudeVersion === 'Not available') return 'error'
    if (!systemInfo || !claudeConfig) return 'warning'
    return 'healthy'
  }

  const formatTokens = (tokens: number) => {
    if (tokens > 1000000) return `${(tokens / 1000000).toFixed(1)}M`
    if (tokens > 1000) return `${(tokens / 1000).toFixed(1)}K`
    return tokens.toString()
  }

  const calculateCost = (inputTokens: number, outputTokens: number) => {
    // Rough estimate based on Claude Sonnet pricing
    const inputCost = (inputTokens / 1000000) * 3.0
    const outputCost = (outputTokens / 1000000) * 15.0
    return inputCost + outputCost
  }

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="text-green-500" size={20} />
      case 'warning': return <AlertTriangle className="text-yellow-500" size={20} />
      case 'error': return <XCircle className="text-red-500" size={20} />
      default: return <Clock className="text-gray-500" size={20} />
    }
  }

  const renderOverview = () => (
    <div className="space-y-6">
      {/* System Status */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center space-x-2">
            <StatusIcon status={getSystemStatus()} />
            <span>Claude Code Status</span>
          </h3>
          <button
            onClick={loadAllData}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Claude Version</p>
            <p className="font-mono text-lg text-foreground">
              {loading.version ? '...' : claudeVersion}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Current Model</p>
            <p className="text-lg text-foreground">
              {claudeConfig?.model || 'sonnet'}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Installation</p>
            <p className="text-lg text-foreground">
              {systemInfo?.claude_npm_info ? 'npm (global)' : 'Unknown'}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Platform</p>
            <p className="text-lg text-foreground">
              {systemInfo ? `${systemInfo.platform} (${systemInfo.arch})` : 'Loading...'}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      {usageStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <BarChart3 className="text-blue-500" size={20} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Tokens</p>
                <p className="text-xl font-semibold text-foreground">
                  {formatTokens(usageStats.total_input_tokens + usageStats.total_output_tokens)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Users className="text-green-500" size={20} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Sessions</p>
                <p className="text-xl font-semibold text-foreground">
                  {usageStats.session_count}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <TrendingUp className="text-purple-500" size={20} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Est. Cost</p>
                <p className="text-xl font-semibold text-foreground">
                  ${calculateCost(usageStats.total_input_tokens, usageStats.total_output_tokens).toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const renderUsage = () => (
    <div className="space-y-6">
      {usageStats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Zap className="text-blue-500" size={16} />
                <span className="text-sm text-muted-foreground">Input Tokens</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{formatTokens(usageStats.total_input_tokens)}</p>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Activity className="text-green-500" size={16} />
                <span className="text-sm text-muted-foreground">Output Tokens</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{formatTokens(usageStats.total_output_tokens)}</p>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <HardDrive className="text-purple-500" size={16} />
                <span className="text-sm text-muted-foreground">Cache Tokens</span>
              </div>
              <p className="text-2xl font-bold text-foreground">
                {formatTokens(usageStats.total_cache_creation_tokens + usageStats.total_cache_read_tokens)}
              </p>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <Calendar className="text-orange-500" size={16} />
                <span className="text-sm text-muted-foreground">Sessions</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{usageStats.session_count}</p>
            </div>
          </div>

          {/* Models Used */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Models Used</h3>
            <div className="space-y-3">
              {Object.entries(usageStats.models_used).map(([model, count]) => (
                <div key={model} className="flex items-center justify-between">
                  <span className="text-foreground">{model || 'Unknown'}</span>
                  <span className="text-muted-foreground">{count} sessions</span>
                </div>
              ))}
            </div>
          </div>

          {/* Daily Usage Chart */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Recent Usage</h3>
            <div className="space-y-2">
              {Object.entries(usageStats.daily_usage)
                .sort(([a], [b]) => b.localeCompare(a))
                .slice(0, 7)
                .map(([date, usage]) => (
                  <div key={date} className="flex items-center justify-between py-2">
                    <span className="text-foreground">{date}</span>
                    <div className="text-right">
                      <span className="text-sm text-muted-foreground">
                        {formatTokens(usage.input_tokens + usage.output_tokens)} tokens
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <BarChart3 size={48} className="text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Loading usage statistics...</p>
          </div>
        </div>
      )}
    </div>
  )

  const renderSystem = () => (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">System Information</h3>
        
        {systemInfo ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <Cpu className="text-blue-500" size={20} />
                <div>
                  <p className="text-sm text-muted-foreground">Node.js Version</p>
                  <p className="font-mono text-foreground">{systemInfo.node_version}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Download className="text-green-500" size={20} />
                <div>
                  <p className="text-sm text-muted-foreground">npm Version</p>
                  <p className="font-mono text-foreground">{systemInfo.npm_version}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <HardDrive className="text-purple-500" size={20} />
                <div>
                  <p className="text-sm text-muted-foreground">Platform</p>
                  <p className="text-foreground">{systemInfo.platform} ({systemInfo.arch})</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Settings className="text-orange-500" size={20} />
                <div>
                  <p className="text-sm text-muted-foreground">Claude Installation</p>
                  <p className="text-foreground">
                    {systemInfo.claude_npm_info ? 'Global npm package' : 'Unknown'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-pulse">
            <div className="h-4 bg-muted rounded w-3/4 mb-3"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
        )}
      </div>
    </div>
  )

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'usage', label: 'Usage Stats', icon: BarChart3 },
    { id: 'system', label: 'System Info', icon: Cpu },
  ] as const

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3 mb-4">
          <Settings size={24} className="text-primary" />
          <div>
            <h2 className="text-2xl font-semibold text-foreground">System Settings</h2>
            <p className="text-muted-foreground mt-1">
              Claude Code system information and configuration
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-muted p-1 rounded-lg">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-all ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={16} />
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'usage' && renderUsage()}
        {activeTab === 'system' && renderSystem()}
      </div>
    </div>
  )
}