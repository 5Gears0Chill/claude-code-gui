'use client'

import { useState } from 'react'
import { Shield, FileText, AlertTriangle, Check, X } from 'lucide-react'

interface PermissionRequest {
  id: string
  type: 'file_read' | 'file_write' | 'directory_access'
  resource: string
  reason?: string
  timestamp: Date
}

interface PermissionDialogProps {
  isOpen: boolean
  request: PermissionRequest | null
  onApprove: (remember?: boolean) => void
  onDeny: (remember?: boolean) => void
  onClose: () => void
}

export function PermissionDialog({ isOpen, request, onApprove, onDeny, onClose }: PermissionDialogProps) {
  const [rememberChoice, setRememberChoice] = useState(false)

  if (!isOpen || !request) return null

  const getPermissionIcon = () => {
    switch (request.type) {
      case 'file_read':
        return <FileText className="text-blue-500" size={24} />
      case 'file_write':
        return <FileText className="text-orange-500" size={24} />
      case 'directory_access':
        return <Shield className="text-purple-500" size={24} />
      default:
        return <AlertTriangle className="text-yellow-500" size={24} />
    }
  }

  const getPermissionTitle = () => {
    switch (request.type) {
      case 'file_read':
        return 'File Read Permission'
      case 'file_write':
        return 'File Write Permission'
      case 'directory_access':
        return 'Directory Access Permission'
      default:
        return 'Permission Request'
    }
  }

  const getPermissionDescription = () => {
    switch (request.type) {
      case 'file_read':
        return `Claude Code wants to read the file:`
      case 'file_write':
        return `Claude Code wants to write to the file:`
      case 'directory_access':
        return `Claude Code wants to access the directory:`
      default:
        return `Claude Code is requesting permission to access:`
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-lg max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex items-center space-x-3 mb-4">
            {getPermissionIcon()}
            <div>
              <h3 className="text-lg font-semibold text-foreground">{getPermissionTitle()}</h3>
              <p className="text-sm text-muted-foreground">Required by Claude Code</p>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-sm text-foreground mb-2">{getPermissionDescription()}</p>
            <div className="bg-muted p-3 rounded-lg">
              <code className="text-sm font-mono text-foreground break-all">{request.resource}</code>
            </div>
            {request.reason && (
              <p className="text-xs text-muted-foreground mt-2">
                <strong>Reason:</strong> {request.reason}
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2 mb-4">
            <input
              type="checkbox"
              id="remember"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="remember" className="text-sm text-foreground">
              Remember my choice for this resource
            </label>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={() => onDeny(rememberChoice)}
              className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <X size={16} />
              <span>Deny</span>
            </button>
            <button
              onClick={() => onApprove(rememberChoice)}
              className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <Check size={16} />
              <span>Allow</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}