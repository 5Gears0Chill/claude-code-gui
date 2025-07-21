'use client'

import { useState, useCallback } from 'react'

interface PermissionRequest {
  id: string
  type: 'file_read' | 'file_write' | 'directory_access'
  resource: string
  reason?: string
  timestamp: Date
}

interface PermissionState {
  pending: PermissionRequest | null
  approved: Set<string>
  denied: Set<string>
}

export function usePermissions() {
  const [state, setState] = useState<PermissionState>({
    pending: null,
    approved: new Set(),
    denied: new Set()
  })

  const requestPermission = useCallback((
    type: PermissionRequest['type'],
    resource: string,
    reason?: string
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const key = `${type}:${resource}`
      
      // Check if we already have a stored decision
      if (state.approved.has(key)) {
        resolve(true)
        return
      }
      
      if (state.denied.has(key)) {
        resolve(false)
        return
      }

      // Create new permission request
      const request: PermissionRequest = {
        id: Date.now().toString(),
        type,
        resource,
        reason,
        timestamp: new Date()
      }

      setState(prev => ({ ...prev, pending: request }))

      // Store the resolve function to be called by approve/deny
      ;(window as any)._permissionResolve = resolve
    })
  }, [state.approved, state.denied])

  const approvePermission = useCallback((remember = false) => {
    if (!state.pending) return
    
    const key = `${state.pending.type}:${state.pending.resource}`
    
    if (remember) {
      setState(prev => ({
        ...prev,
        approved: new Set([...Array.from(prev.approved), key]),
        pending: null
      }))
    } else {
      setState(prev => ({ ...prev, pending: null }))
    }

    // Resolve the promise
    if ((window as any)._permissionResolve) {
      ;(window as any)._permissionResolve(true)
      delete (window as any)._permissionResolve
    }
  }, [state.pending])

  const denyPermission = useCallback((remember = false) => {
    if (!state.pending) return
    
    const key = `${state.pending.type}:${state.pending.resource}`
    
    if (remember) {
      setState(prev => ({
        ...prev,
        denied: new Set([...Array.from(prev.denied), key]),
        pending: null
      }))
    } else {
      setState(prev => ({ ...prev, pending: null }))
    }

    // Resolve the promise
    if ((window as any)._permissionResolve) {
      ;(window as any)._permissionResolve(false)
      delete (window as any)._permissionResolve
    }
  }, [state.pending])

  const closePermissionDialog = useCallback(() => {
    setState(prev => ({ ...prev, pending: null }))
    
    // Resolve the promise with false (denied)
    if ((window as any)._permissionResolve) {
      ;(window as any)._permissionResolve(false)
      delete (window as any)._permissionResolve
    }
  }, [])

  const clearPermissions = useCallback(() => {
    setState({
      pending: null,
      approved: new Set(),
      denied: new Set()
    })
  }, [])

  return {
    pendingRequest: state.pending,
    requestPermission,
    approvePermission,
    denyPermission,
    closePermissionDialog,
    clearPermissions,
    hasApproval: (type: string, resource: string) => state.approved.has(`${type}:${resource}`),
    isDenied: (type: string, resource: string) => state.denied.has(`${type}:${resource}`)
  }
}