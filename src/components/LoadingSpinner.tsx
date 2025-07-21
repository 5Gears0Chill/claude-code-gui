'use client'

import { Terminal } from 'lucide-react'

interface LoadingSpinnerProps {
  message?: string
  size?: 'sm' | 'md' | 'lg'
}

export function LoadingSpinner({ message = 'Loading...', size = 'md' }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12', 
    lg: 'w-16 h-16'
  }

  const iconSizes = {
    sm: 16,
    md: 24,
    lg: 32
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <div className={`${sizeClasses[size]} relative`}>
        {/* Outer spinning ring */}
        <div className={`${sizeClasses[size]} absolute inset-0 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin`} />
        
        {/* Inner terminal icon */}
        <div className={`${sizeClasses[size]} flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 rounded-full`}>
          <Terminal size={iconSizes[size]} className="text-white" />
        </div>
      </div>
      
      {message && (
        <p className="text-gray-600 text-sm font-medium animate-pulse">
          {message}
        </p>
      )}
    </div>
  )
}