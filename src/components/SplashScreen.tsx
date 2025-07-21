'use client'

import { useState, useEffect } from 'react'
import { Terminal, Code, Sparkles, Zap } from 'lucide-react'

interface SplashScreenProps {
  isVisible: boolean
  onComplete: () => void
}

export function SplashScreen({ isVisible, onComplete }: SplashScreenProps) {
  const [loadingStep, setLoadingStep] = useState(0)
  const [progress, setProgress] = useState(0)

  const loadingSteps = [
    'Initializing Claude Code GUI...',
    'Loading project scanner...',
    'Setting up terminal interface...',
    'Preparing file explorer...',
    'Ready to code with Claude!'
  ]

  useEffect(() => {
    if (!isVisible) return

    // Simulate loading sequence
    let stepIndex = 0
    let progressValue = 0

    const stepInterval = setInterval(() => {
      if (stepIndex < loadingSteps.length - 1) {
        stepIndex++
        setLoadingStep(stepIndex)
      }
    }, 800)

    const progressInterval = setInterval(() => {
      progressValue += Math.random() * 15 + 5
      if (progressValue >= 100) {
        progressValue = 100
        setProgress(100)
        
        // Complete after a short delay
        setTimeout(() => {
          onComplete()
        }, 500)
        
        clearInterval(progressInterval)
        clearInterval(stepInterval)
      } else {
        setProgress(progressValue)
      }
    }, 200)

    return () => {
      clearInterval(stepInterval)
      clearInterval(progressInterval)
    }
  }, [isVisible, onComplete])

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center z-50">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-full blur-3xl animate-ping"></div>
      </div>

      {/* Main content */}
      <div className="relative z-10 text-center max-w-md mx-auto px-6">
        {/* Logo/Icon */}
        <div className="mb-8 relative">
          <div className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-2xl">
            <Terminal size={40} className="text-white" />
          </div>
          
          {/* Floating icons */}
          <div className="absolute -top-2 -right-2 w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center animate-bounce delay-300">
            <Sparkles size={16} className="text-yellow-900" />
          </div>
          <div className="absolute -bottom-2 -left-2 w-8 h-8 bg-green-400 rounded-full flex items-center justify-center animate-bounce delay-700">
            <Code size={16} className="text-green-900" />
          </div>
          <div className="absolute top-1/2 -right-6 w-6 h-6 bg-pink-400 rounded-full flex items-center justify-center animate-bounce delay-1000">
            <Zap size={12} className="text-pink-900" />
          </div>
        </div>

        {/* App name */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Claude Code GUI
          </h1>
          <p className="text-gray-300 text-lg">
            Beautiful interface for Claude Code CLI
          </p>
        </div>

        {/* Loading indicator */}
        <div className="mb-6">
          <div className="w-full bg-gray-700/50 rounded-full h-2 mb-4 overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          <div className="flex items-center justify-center space-x-2 text-gray-300">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium">
              {loadingSteps[loadingStep]}
            </span>
          </div>
        </div>

        {/* Progress percentage */}
        <div className="text-gray-400 text-sm">
          {Math.round(progress)}%
        </div>
      </div>

      {/* Animated grid background */}
      <div className="absolute inset-0 opacity-10">
        <div className="w-full h-full" style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          animation: 'grid-move 20s linear infinite'
        }} />
      </div>

      <style jsx>{`
        @keyframes grid-move {
          0% { transform: translate(0, 0); }
          100% { transform: translate(50px, 50px); }
        }
      `}</style>
    </div>
  )
}